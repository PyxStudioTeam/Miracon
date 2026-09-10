import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LocalMediaCleanupError, runLocalMediaCleanup } from '../scripts/local-media-cleanup.mjs';
import { migrate } from '../scripts/postgres-migrate.mjs';

const databaseUrl = requireSafeDatabaseUrl();
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const temporaryRoots: string[] = [];
const now = new Date('2026-08-20T12:00:00.000Z');
const oldDate = new Date('2026-08-01T12:00:00.000Z');

beforeAll(async () => {
  await pool.query('drop schema if exists miracon cascade; drop schema if exists miracon_meta cascade');
  await migrate(databaseUrl);
}, 30_000);

beforeEach(async () => {
  await pool.query('truncate miracon.projects cascade; delete from miracon.media_files');
});

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

afterAll(async () => {
  await pool.end();
});

describe('local media cleanup apply protocol', () => {
  it('deletes an orphan and safely finalizes metadata for an already missing file', async () => {
    // Given
    const root = await temporaryRoot();
    await Promise.all([insertMedia('present'), insertMedia('missing')]);
    const path = await writeMedia(root, 'present', 'delete me');

    // When
    const result = await cleanup(root);

    // Then
    expect(result.deleted).toMatchObject([
      { id: 'missing', fileStatus: 'missing' },
      { id: 'present', fileStatus: 'deleted' },
    ]);
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await pool.query('select id from miracon.media_files')).rows).toEqual([]);
  });

  it('requires the explicit exclusive-writer contract before apply', async () => {
    // Given
    const root = await temporaryRoot();
    await insertMedia('blocked');
    const path = await writeMedia(root, 'blocked', 'still present');

    // When / Then
    await expect(cleanup(root, { exclusiveWriter: false })).rejects.toBeInstanceOf(LocalMediaCleanupError);
    expect(await readFile(path, 'utf8')).toBe('still present');
    expect(await pendingState('blocked')).toBeNull();
  });

  it('commits pending state before unlink and retries after process failure', async () => {
    // Given
    const root = await temporaryRoot();
    await insertMedia('interrupted');
    const path = await writeMedia(root, 'interrupted', 'retry me');

    // When
    await expect(cleanup(root, {
      afterPendingCommit: () => Promise.reject(new Error('injected process failure')),
    })).rejects.toBeInstanceOf(LocalMediaCleanupError);

    // Then
    expect(await readFile(path, 'utf8')).toBe('retry me');
    expect(await pendingState('interrupted')).not.toBeNull();
    const retried = await cleanup(root);
    expect(retried.deleted).toMatchObject([{ id: 'interrupted', fileStatus: 'deleted' }]);
  });

  it('clears pending state and retains a candidate re-referenced after marking', async () => {
    // Given
    const root = await temporaryRoot();
    await insertMedia('re-referenced');
    const path = await writeMedia(root, 're-referenced', 'referenced');

    // When
    const result = await cleanup(root, {
      afterPendingCommit: async () => {
        await pool.query('insert into miracon.projects (id, slug, title, cover_url) values ($1, $2, $3, $4)', [
          'race-project', 'race-project', 'Race project', mediaUrl('re-referenced'),
        ]);
      },
    });

    // Then
    expect(result.deleted).toEqual([]);
    expect(await readFile(path, 'utf8')).toBe('referenced');
    expect(await pendingState('re-referenced')).toBeNull();
  });

  it('keeps durable pending metadata when unlink fails', async () => {
    // Given
    const root = await temporaryRoot();
    await insertMedia('unlink-failure');
    const path = await writeMedia(root, 'unlink-failure', 'retry unlink');

    // When / Then
    await expect(cleanup(root, {
      removeCandidate: () => Promise.reject(new Error('injected unlink failure')),
    })).rejects.toBeInstanceOf(LocalMediaCleanupError);
    expect(await readFile(path, 'utf8')).toBe('retry unlink');
    expect(await pendingState('unlink-failure')).not.toBeNull();
    await expect(cleanup(root)).resolves.toMatchObject({ deleted: [{ id: 'unlink-failure', fileStatus: 'deleted' }] });
  });

  it('keeps durable pending metadata when finalization fails after unlink', async () => {
    // Given
    const root = await temporaryRoot();
    await insertMedia('finalize-failure');
    const path = await writeMedia(root, 'finalize-failure', 'unlink first');
    const database = failingDatabase((text) => text.includes('delete from miracon.media_files'));

    // When / Then
    await expect(cleanup(root, { database })).rejects.toBeInstanceOf(LocalMediaCleanupError);
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await pendingState('finalize-failure')).not.toBeNull();
    const retried = await cleanup(root);
    expect(retried.deleted).toMatchObject([{ id: 'finalize-failure', fileStatus: 'missing' }]);
  });

  it('keeps durable pending metadata when the final commit fails after unlink', async () => {
    // Given
    const root = await temporaryRoot();
    await insertMedia('commit-failure');
    const path = await writeMedia(root, 'commit-failure', 'unlink first');
    let commits = 0;
    const database = failingDatabase((text) => text.trim().toLowerCase() === 'commit' && ++commits === 2);

    // When / Then
    await expect(cleanup(root, { database })).rejects.toBeInstanceOf(LocalMediaCleanupError);
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await pendingState('commit-failure')).not.toBeNull();
    await expect(cleanup(root)).resolves.toMatchObject({ deleted: [{ id: 'commit-failure', fileStatus: 'missing' }] });
  });

  it('rejects an ancestor replaced by a symlink immediately before unlink', async () => {
    // Given
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    await insertMedia('ancestor-race');
    const candidateDirectory = join(root, 'uploads', 'ancestor-race');
    const retainedDirectory = join(root, 'uploads', 'ancestor-race-retained');
    await writeMedia(root, 'ancestor-race', 'original');
    await writeFile(join(outside, 'ancestor-race.bin'), 'outside');

    // When / Then
    await expect(cleanup(root, {
      beforeUnlink: async () => {
        await rename(candidateDirectory, retainedDirectory);
        await symlink(outside, candidateDirectory, 'junction');
      },
    })).rejects.toBeInstanceOf(LocalMediaCleanupError);
    expect(await readFile(join(outside, 'ancestor-race.bin'), 'utf8')).toBe('outside');
    expect(await readFile(join(retainedDirectory, 'ancestor-race.bin'), 'utf8')).toBe('original');
    expect(await pendingState('ancestor-race')).not.toBeNull();
  });

  it('retains the file and metadata for old media referenced only by revision history', async () => {
    // Given
    const root = await temporaryRoot();
    const mediaId = 'revision-history-apply';
    const aggregateId = 'revision-history-apply-project';
    await insertMedia(mediaId);
    const path = await writeMedia(root, mediaId, 'revision evidence');
    await pool.query(`with revision as (
      insert into miracon.content_revisions
        (aggregate_type, aggregate_id, revision_number, state, action, snapshot, approved_at)
      values ('project', $1, 1, 'approved', 'baseline', $2::jsonb, clock_timestamp())
      returning id
    )
    insert into miracon.revision_media (revision_id, media_file_id)
    select id, $3 from revision`, [
      aggregateId,
      JSON.stringify({ aggregateType: 'project', aggregateId, deleted: true, project: null, images: [] }),
      mediaId,
    ]);

    // When
    const result = await cleanup(root);

    // Then
    expect(result.deleted).toEqual([]);
    expect(await readFile(path, 'utf8')).toBe('revision evidence');
    expect((await pool.query('select id, relative_path from miracon.media_files where id = $1', [mediaId])).rows).toEqual([
      { id: mediaId, relative_path: mediaPath(mediaId) },
    ]);
  });
});

type CleanupOverrides = {
  readonly database?: typeof pool | ReturnType<typeof failingDatabase>;
  readonly exclusiveWriter?: boolean;
  readonly afterPendingCommit?: () => Promise<void>;
  readonly beforeUnlink?: () => Promise<void>;
  readonly removeCandidate?: () => Promise<'deleted' | 'missing'>;
};

function cleanup(root: string, overrides: CleanupOverrides = {}) {
  return runLocalMediaCleanup({
    database: overrides.database ?? pool,
    mediaRoot: root,
    siteOrigin: 'https://miracon.test',
    now,
    graceDays: 7,
    apply: true,
    exclusiveWriter: overrides.exclusiveWriter ?? true,
    hooks: {
      afterPendingCommit: overrides.afterPendingCommit,
      beforeUnlink: overrides.beforeUnlink,
    },
    filesystem: overrides.removeCandidate ? { removeCandidate: overrides.removeCandidate } : undefined,
  });
}

function failingDatabase(shouldFail: (text: string) => boolean) {
  return {
    query: pool.query.bind(pool),
    async connect() {
      const client = await pool.connect();
      return {
        query: (text: string, values?: unknown[]) => shouldFail(text)
          ? Promise.reject(new Error('injected database failure'))
          : client.query(text, values),
        release: () => client.release(),
      };
    },
  };
}

async function insertMedia(id: string): Promise<void> {
  await pool.query(`insert into miracon.media_files
    (id, relative_url, relative_path, mime_type, size_bytes, sha256, created_at)
    values ($1, $2, $3, 'application/octet-stream', 1, decode(repeat('00', 32), 'hex'), $4)`,
  [id, mediaUrl(id), mediaPath(id), oldDate]);
}

async function pendingState(id: string): Promise<string | null> {
  const result = await pool.query('select deletion_pending_at from miracon.media_files where id = $1', [id]);
  return result.rows[0]?.deletion_pending_at ?? null;
}

async function writeMedia(root: string, id: string, contents: string): Promise<string> {
  const path = join(root, mediaPath(id));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  return path;
}

function mediaUrl(id: string): string {
  return `/media/${mediaPath(id)}`;
}

function mediaPath(id: string): string {
  return `uploads/${id}/${id}.bin`;
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'miracon-media-cleanup-'));
  temporaryRoots.push(root);
  await mkdir(join(root, 'uploads'));
  return root;
}

function requireSafeDatabaseUrl(): string {
  const value = process.env.DATABASE_TEST_URL;
  if (!value || process.env.DATABASE_TEST_ALLOW_RESET !== '1' || !/(?:^|[_-])(?:test|testing|ci|disposable|tmp)(?:$|[_-])/iu.test(new URL(value).pathname)) {
    throw new Error('Guarded DATABASE_TEST_URL and DATABASE_TEST_ALLOW_RESET=1 are required');
  }
  return value;
}

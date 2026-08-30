import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../scripts/postgres-migrate.mjs';
import {
  MEDIA_LIMITS,
  createMediaFileRepository,
  createMediaRoot,
  mimeContractFor,
  prepareMediaRead,
  saveMediaFile,
} from '../src/lib/server/media/index';

const databaseUrl = requireSafeDatabaseUrl();
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const temporaryRoots: string[] = [];

beforeAll(async () => {
  await pool.query('drop schema if exists miracon cascade; drop schema if exists miracon_meta cascade');
  await migrate(databaseUrl);
}, 30_000);

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

afterAll(async () => {
  await pool.end();
});

describe('local media roots and contracts', () => {
  it('rejects a relative MEDIA_ROOT and initializes an absolute writable root', async () => {
    // Given
    const absoluteRoot = await temporaryRoot();

    // When
    const relative = await createMediaRoot('media');
    const configured = await createMediaRoot(absoluteRoot);

    // Then
    expect(relative).toEqual({ ok: false, error: { kind: 'configuration', message: 'MEDIA_ROOT must be an absolute path' } });
    expect(configured).toMatchObject({ ok: true, value: { path: absoluteRoot } });
  });

  it('defines explicit MIME and size contracts for local media', () => {
    // Given / When
    const jpeg = mimeContractFor('image/jpeg');
    const video = mimeContractFor('video/mp4');
    const svg = mimeContractFor('image/svg+xml');
    const pdf = mimeContractFor('application/pdf');

    // Then
    expect(jpeg).toEqual({ ok: true, value: { extension: 'jpg', maxBytes: MEDIA_LIMITS.image } });
    expect(video).toEqual({ ok: true, value: { extension: 'mp4', maxBytes: MEDIA_LIMITS.video } });
    expect(svg).toEqual({ ok: true, value: { extension: 'svg', maxBytes: MEDIA_LIMITS.image } });
    expect(pdf).toEqual({ ok: true, value: { extension: 'pdf', maxBytes: MEDIA_LIMITS.pdf } });
    expect(mimeContractFor('text/plain')).toEqual({ ok: false, error: { kind: 'invalid_upload', message: 'Unsupported media MIME type' } });
  });
});

describe('local media persistence', () => {
  it('writes through a temporary file, hashes it, atomically publishes it, and inserts metadata', async () => {
    // Given
    const root = await mediaRoot();
    const source = Buffer.concat([mp4Signature(), Buffer.from('safe mp4 bytes')]);

    // When
    const saved = await saveMediaFile({
      root,
      source: Readable.from([source]),
      mimeType: 'video/mp4',
      originalName: '../../client-path.mp4',
      repository: createMediaFileRepository(pool),
    });

    // Then
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(saved.error.message);
    expect(saved.value.relativePath).toMatch(/^uploads\/[0-9a-f-]+\/[0-9a-f-]+\.mp4$/u);
    expect(saved.value.relativeUrl).toBe(`/media/${saved.value.relativePath}`);
    expect(saved.value.relativePath).not.toContain('client-path');
    expect(await readFile(join(root.path, saved.value.relativePath))).toEqual(source);
    expect(await readdir(join(root.path, '.tmp'))).toEqual([]);
    const stored = await pool.query('select relative_url, relative_path, sha256, size_bytes from miracon.media_files where id = $1', [saved.value.id]);
    expect(stored.rows).toEqual([{
      relative_url: saved.value.relativeUrl,
      relative_path: saved.value.relativePath,
      sha256: createHash('sha256').update(source).digest(),
      size_bytes: String(source.length),
    }]);
  });

  it('removes the published file when the media_files insert fails', async () => {
    // Given
    const root = await mediaRoot();

    // When
    const saved = await saveMediaFile({
      root,
      source: Readable.from([Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('metadata failure')])]),
      mimeType: 'application/pdf',
      uploadedBy: 99_999,
      repository: createMediaFileRepository(pool),
    });

    // Then
    expect(saved).toMatchObject({ ok: false, error: { kind: 'metadata' } });
    expect(await readdir(join(root.path, 'uploads'))).toEqual([]);
  });

  it('rejects empty and over-limit streams without publishing a file', async () => {
    // Given
    const root = await mediaRoot();

    // When
    const empty = await saveMediaFile({ root, source: Readable.from([]), mimeType: 'image/jpeg', repository: createMediaFileRepository(pool) });
    const tooLarge = await saveMediaFile({
      root,
      source: Readable.from([Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(MEDIA_LIMITS.image)])]),
      mimeType: 'image/jpeg',
      repository: createMediaFileRepository(pool),
    });

    // Then
    expect(empty).toEqual({ ok: false, error: { kind: 'invalid_upload', message: 'Media file must not be empty' } });
    expect(tooLarge).toEqual({ ok: false, error: { kind: 'invalid_upload', message: 'Media file exceeds its size limit' } });
    expect(await readdir(join(root.path, 'uploads'))).toEqual([]);
  });
});

describe('safe local media reads', () => {
  it('prepares GET, HEAD, and byte-range reads without buffering the full file', async () => {
    // Given
    const root = await mediaRoot();
    const source = Buffer.concat([mp4Signature(), Buffer.from('0123456789')]);
    const saved = await saveMediaFile({
      root,
      source: Readable.from([source]),
      mimeType: 'video/mp4',
      repository: createMediaFileRepository(pool),
    });
    if (!saved.ok) throw new Error(saved.error.message);

    // When
    const full = await prepareMediaRead({ root, relativePath: saved.value.relativePath, method: 'GET' });
    const start = mp4Signature().length + 2;
    const head = await prepareMediaRead({ root, relativePath: saved.value.relativePath, method: 'HEAD', rangeHeader: `bytes=${start}-${start + 3}` });
    const suffix = await prepareMediaRead({ root, relativePath: saved.value.relativePath, method: 'GET', rangeHeader: 'bytes=-3' });

    // Then
    expect(full).toMatchObject({ ok: true, value: { status: 200, contentLength: source.length, range: null } });
    if (!full.ok || !full.value.body) throw new Error('GET read must contain a stream');
    expect(await text(full.value.body)).toBe(source.toString());
    expect(head).toMatchObject({ ok: true, value: { status: 206, contentLength: 4, range: { start, end: start + 3 }, body: null } });
    expect(suffix).toMatchObject({ ok: true, value: { status: 206, contentLength: 3, range: { start: source.length - 3, end: source.length - 1 } } });
    if (!suffix.ok || !suffix.value.body) throw new Error('Range GET must contain a stream');
    expect(await text(suffix.value.body)).toBe('789');
  });

  it('rejects traversal, symlink escapes, and unsatisfiable ranges', async () => {
    // Given
    const root = await mediaRoot();
    const outside = await temporaryRoot();
    await writeFile(join(outside, 'secret.mp4'), 'secret');
    await symlink(outside, join(root.path, 'escape'), 'junction');
    const saved = await saveMediaFile({
      root,
      source: Readable.from([mp4Signature()]),
      mimeType: 'video/mp4',
      repository: createMediaFileRepository(pool),
    });
    if (!saved.ok) throw new Error(saved.error.message);

    // When
    const traversal = await prepareMediaRead({ root, relativePath: '../secret.mp4', method: 'GET' });
    const escaped = await prepareMediaRead({ root, relativePath: 'escape/secret.mp4', method: 'GET' });
    const missingRange = await prepareMediaRead({ root, relativePath: saved.value.relativePath, method: 'GET', rangeHeader: 'bytes=99-100' });

    // Then
    expect(traversal).toEqual({ ok: false, error: { kind: 'unsafe_path', message: 'Media path is outside MEDIA_ROOT' } });
    expect(escaped).toEqual({ ok: false, error: { kind: 'unsafe_path', message: 'Media path contains a symbolic link' } });
    expect(missingRange).toEqual({ ok: false, error: { kind: 'range_not_satisfiable', message: 'Requested range is not satisfiable' } });
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'miracon-media-'));
  temporaryRoots.push(root);
  return root;
}

async function mediaRoot() {
  const configured = await createMediaRoot(await temporaryRoot());
  if (!configured.ok) throw new Error(configured.error.message);
  return configured.value;
}

function requireSafeDatabaseUrl(): string {
  const value = process.env.DATABASE_TEST_URL;
  if (!value || process.env.DATABASE_TEST_ALLOW_RESET !== '1' || !/(?:^|[_-])(?:test|testing|ci|disposable|tmp)(?:$|[_-])/iu.test(new URL(value).pathname)) {
    throw new Error('Guarded DATABASE_TEST_URL and DATABASE_TEST_ALLOW_RESET=1 are required');
  }
  return value;
}

function mp4Signature(): Buffer {
  return Buffer.from('\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isom', 'binary');
}

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { sourceRows } from '../migration-tests/fixtures.mjs';
import { exportSupabaseContent, parseExportArguments } from '../scripts/supabase-export.mjs';

function clientFor(rows = sourceRows) {
  return {
    from(table) {
      const key = { projects: 'projects', project_images: 'projectImages', homepage_videos: 'homepageVideos' }[table];
      const query = {
        select() { return this; }, order() { return this; }, eq() { return this; },
        range(from, to) { const data = rows[key].slice(from, to + 1); return Promise.resolve({ data, count: rows[key].length, error: null }); },
        single() { return Promise.resolve({ data: rows.siteSettings, error: null }); },
      };
      return query;
    },
  };
}

async function fixture(t) {
  const root = await mkdtemp(join(process.env.TEMP, 'miracon-export-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const migrationsDirectory = join(root, 'postgres', 'migrations');
  await mkdir(migrationsDirectory, { recursive: true });
  await writeFile(join(migrationsDirectory, '0002_second.sql'), 'select 2;\n');
  await writeFile(join(migrationsDirectory, '0001_first.sql'), 'select 1;\n');
  return { root, migrationsDirectory, output: join(root, 'export') };
}

const baseOptions = (paths, overrides = {}) => ({
  sourceClient: clientFor(), sourceUrl: 'https://fake-project.supabase.co',
  siteOrigins: ['https://www.example.test'], migrationsDirectory: paths.migrationsDirectory,
  outputDirectory: paths.output, now: () => new Date('2026-08-12T10:00:00.000Z'), ...overrides,
});

test('writes deterministic snapshot and manifest artifacts', async (t) => {
  // Given
  const paths = await fixture(t);
  // When
  const secret = 'fake-service-role-secret';
  const first = await exportSupabaseContent(baseOptions(paths, { serviceRoleKey: secret }));
  const snapshotText = await readFile(join(paths.output, 'snapshot.json'), 'utf8');
  const manifest = JSON.parse(await readFile(join(paths.output, 'manifest.json'), 'utf8'));
  // Then
  assert.equal(manifest.snapshotId, first.snapshotId);
  assert.deepEqual(manifest.files.map(({ filename }) => filename), ['snapshot.json']);
  assert.deepEqual(JSON.parse(snapshotText).content.targetMigrations.map(({ filename }) => filename), ['0001_first.sql', '0002_second.sql']);
  assert.doesNotMatch(snapshotText, new RegExp(secret));
});

test('refuses overwrite and force replaces changed content', async (t) => {
  // Given
  const paths = await fixture(t);
  await exportSupabaseContent(baseOptions(paths));
  const changed = structuredClone(sourceRows);
  changed.projects[0].title = 'Changed title';
  // When / Then
  await assert.rejects(exportSupabaseContent(baseOptions(paths)), /already exists.*force/i);
  const result = await exportSupabaseContent(baseOptions(paths, { sourceClient: clientFor(changed), force: true }));
  assert.equal(JSON.parse(await readFile(join(paths.output, 'snapshot.json'), 'utf8')).content.projects[0].title, 'Changed title');
  assert.match(result.snapshotId, /^snapshot-[a-f0-9]{64}$/u);
});

test('force exporting unchanged content is idempotent', async (t) => {
  // Given
  const paths = await fixture(t);
  await exportSupabaseContent(baseOptions(paths));
  const before = await readFile(join(paths.output, 'snapshot.json'), 'utf8');
  // When
  const result = await exportSupabaseContent(baseOptions(paths, { force: true, now: () => new Date('2026-08-13T10:00:00.000Z') }));
  // Then
  assert.equal(result.unchanged, true);
  assert.equal(await readFile(join(paths.output, 'snapshot.json'), 'utf8'), before);
});

test('dry-run and validate complete the export without writing', async (t) => {
  // Given
  const paths = await fixture(t);
  // When
  const dryRun = await exportSupabaseContent(baseOptions(paths, { dryRun: true }));
  const validate = await exportSupabaseContent(baseOptions(paths, { validate: true }));
  // Then
  assert.equal(dryRun.counts.projects, 1);
  assert.equal(validate.counts.siteSettings, 1);
  await assert.rejects(readdir(paths.output), { code: 'ENOENT' });
});

test('failed artifact write removes staging and preserves existing output', async (t) => {
  // Given
  const paths = await fixture(t);
  await mkdir(paths.output);
  await writeFile(join(paths.output, 'keep.txt'), 'original');
  // When
  await assert.rejects(exportSupabaseContent(baseOptions(paths, {
    force: true,
    writeArtifact: async ({ filename, ...artifact }) => {
      if (filename === 'manifest.json') throw new Error('simulated write failure');
      await artifact.defaultWrite();
    },
  })), /simulated write failure/);
  // Then
  assert.equal(await readFile(join(paths.output, 'keep.txt'), 'utf8'), 'original');
  assert.deepEqual((await readdir(paths.root)).filter((name) => name.includes('.export.')), []);
});

test('parses explicit output, no-write modes, force, origins, and page size', () => {
  // Given / When
  const options = parseExportArguments(['--output=out', '--dry-run', '--validate', '--force', '--site-origin=https://one.test', '--site-origin=https://two.test', '--page-size=25']);
  // Then
  assert.deepEqual(options, { output: 'out', dryRun: true, validate: true, force: true, siteOrigins: ['https://one.test', 'https://two.test'], pageSize: 25 });
});

test('rejects credential-bearing and insecure production source URLs without echoing them', async (t) => {
  // Given
  const paths = await fixture(t);
  const credentialUrl = 'https://username:password@fake-project.supabase.co';
  // When / Then
  await assert.rejects(exportSupabaseContent(baseOptions(paths, { sourceUrl: credentialUrl })), (error) => {
    assert.match(error.message, /must not contain credentials/i);
    assert.doesNotMatch(error.message, /username|password/);
    return true;
  });
  await assert.rejects(exportSupabaseContent(baseOptions(paths, { sourceClient: undefined, sourceUrl: 'http://fake-project.supabase.co', serviceRoleKey: 'secret' })), /must use HTTPS/i);
});

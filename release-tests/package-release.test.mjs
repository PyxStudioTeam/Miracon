import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { packageRelease } from '../scripts/package-release.mjs';

const fixtureFiles = {
  'app.js': "import './dist/server/entry.mjs';\n",
  'dist/client/assets/site.css': 'body { color: black; }\n',
  'dist/client/index.html': '<!doctype html>\n',
  'dist/server/entry.mjs': "console.log('server');\n",
  'package-lock.json': '{"lockfileVersion":3}\n',
  'package.json': '{"name":"fixture","version":"2.4.0","type":"module","engines":{"node":">=22.12.0"}}\n',
  'postgres/migrations/0001_initial.sql': 'select 1;\n',
  'scripts/postgres-migrate.mjs': 'export const migrate = true;\n',
  'scripts/provision-admin.mjs': 'export const provision = true;\n',
  'scripts/supabase-import.mjs': 'export const importSnapshot = true;\n',
  'scripts/verify-media-state.mjs': 'export const verifyMedia = true;\n',
  'scripts/migration/import-artifacts.mjs': 'export const load = true;\n',
  'scripts/migration/import-database.mjs': 'export const write = true;\n',
  'scripts/migration/import-preparation.mjs': 'export const prepare = true;\n',
  'scripts/migration/media-paths.mjs': 'export const paths = true;\n',
  'scripts/migration/media-filesystem.mjs': 'export const filesystem = true;\n',
  'scripts/migration/media-state-verifier.mjs': 'export const verifier = true;\n',
  'scripts/migration/parity-report.mjs': 'export const parity = true;\n',
  'scripts/migration/postgres-import.mjs': 'export const postgresImport = true;\n',
  'scripts/migration/transfer-contract.mjs': 'export const contract = true;\n',
  'scripts/migration/validate-transfer.mjs': 'export const validate = true;\n',
};

async function createFixture() {
  const projectRoot = await mkdtemp(join(tmpdir(), 'miracon-release-test-'));
  for (const [relativePath, contents] of Object.entries(fixtureFiles)) {
    const destination = join(projectRoot, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
  return projectRoot;
}

async function withFixture(run) {
  const projectRoot = await createFixture();
  try {
    await run(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

test('writes a sorted deterministic manifest when package inputs are valid', async () => {
  await withFixture(async (projectRoot) => {
    // Given
    const output = join(projectRoot, 'artifacts', 'release');
    const createdAt = new Date('2026-08-12T10:00:00.000Z');

    // When
    await packageRelease({ projectRoot, output, createdAt });

    // Then
    const manifest = JSON.parse(await readFile(join(output, 'release-manifest.json'), 'utf8'));
    const paths = manifest.files.map((file) => file.path);
    assert.deepEqual(paths, [...paths].sort());
    assert.equal(manifest.version, 1);
    assert.equal(manifest.applicationVersion, '2.4.0');
    assert.equal(manifest.createdAt, createdAt.toISOString());
    assert.equal(manifest.nodeEngine, '>=22.12.0');
    assert.equal(paths.includes('release-manifest.json'), false);
    assert.equal(paths.includes('tmp/.gitkeep'), true);
    for (const requiredPath of [
      'app.js', 'dist/server/entry.mjs', 'package.json', 'package-lock.json',
      'postgres/migrations/0001_initial.sql',
      'scripts/postgres-migrate.mjs', 'scripts/provision-admin.mjs', 'scripts/supabase-import.mjs',
      'scripts/verify-media-state.mjs',
      'scripts/migration/import-artifacts.mjs', 'scripts/migration/import-database.mjs',
      'scripts/migration/import-preparation.mjs', 'scripts/migration/media-paths.mjs',
      'scripts/migration/media-filesystem.mjs', 'scripts/migration/media-state-verifier.mjs',
      'scripts/migration/parity-report.mjs', 'scripts/migration/postgres-import.mjs',
      'scripts/migration/transfer-contract.mjs', 'scripts/migration/validate-transfer.mjs',
    ]) assert.equal(paths.includes(requiredPath), true, `${requiredPath} must be packaged`);
    for (const file of manifest.files) {
      const contents = await readFile(join(output, ...file.path.split('/')));
      assert.equal(file.bytes, contents.byteLength);
      assert.equal(file.sha256, createHash('sha256').update(contents).digest('hex'));
    }
  });
});

test('does not package workstation-only migration tooling', async () => {
  await withFixture(async (projectRoot) => {
    for (const relativePath of [
      'scripts/supabase-export.mjs', 'scripts/supabase-media-transfer.mjs',
      'scripts/migration/media-transfer.mjs', 'scripts/migration/supabase-source.mjs',
      'scripts/migration/supabase-storage-downloader.mjs',
    ]) {
      const destination = join(projectRoot, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, 'export const offlineOnly = true;\n');
    }
    await packageRelease({ projectRoot, output: join(projectRoot, 'release') });
    const manifest = JSON.parse(await readFile(join(projectRoot, 'release/release-manifest.json'), 'utf8'));
    const paths = new Set(manifest.files.map((file) => file.path));
    for (const relativePath of [
      'scripts/supabase-export.mjs', 'scripts/supabase-media-transfer.mjs',
      'scripts/migration/media-transfer.mjs', 'scripts/migration/supabase-source.mjs',
      'scripts/migration/supabase-storage-downloader.mjs',
    ]) assert.equal(paths.has(relativePath), false, `${relativePath} must remain workstation-only`);
  });
});

test('excludes forbidden files inside selected package directories', async () => {
  await withFixture(async (projectRoot) => {
    // Given
    const forbiddenPaths = [
      'dist/client/.env.production',
      'dist/client/admin-credentials.json',
      'dist/client/debug.log',
      'dist/client/exports/data.json',
      'dist/server/test-fixtures/session.json',
      'dist/server/qa-output/report.txt',
      'dist/server/.omo/session.json',
      'dist/server/.playwright-mcp/browser.json',
      'dist/server/deploy-artifacts/archive.zip',
      'dist/server/test-results/result.json',
      'dist/server/tmp/scratch.json',
      'dist/server/request.trace',
    ];
    for (const relativePath of forbiddenPaths) {
      const destination = join(projectRoot, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, 'must-not-ship\n');
    }
    const output = join(projectRoot, 'release');

    // When
    await packageRelease({ projectRoot, output });

    // Then
    const manifest = JSON.parse(await readFile(join(output, 'release-manifest.json'), 'utf8'));
    assert.equal(manifest.files.some((file) => forbiddenPaths.includes(file.path)), false);
  });
});

test('refuses to overwrite an existing release unless force is explicit', async () => {
  await withFixture(async (projectRoot) => {
    // Given
    const output = join(projectRoot, 'release');
    await mkdir(output);
    await writeFile(join(output, 'owned.txt'), 'keep\n');

    // When
    const packaging = packageRelease({ projectRoot, output });

    // Then
    await assert.rejects(packaging, /already exists/u);
    assert.equal(await readFile(join(output, 'owned.txt'), 'utf8'), 'keep\n');
  });
});

test('atomically replaces an existing release when force is explicit', async () => {
  await withFixture(async (projectRoot) => {
    // Given
    const output = join(projectRoot, 'release');
    await mkdir(output);
    await writeFile(join(output, 'obsolete.txt'), 'remove\n');

    // When
    await packageRelease({ projectRoot, output, force: true });

    // Then
    await assert.rejects(lstat(join(output, 'obsolete.txt')), /ENOENT/u);
    assert.equal(await readFile(join(output, 'app.js'), 'utf8'), fixtureFiles['app.js']);
  });
});

test('refuses a project whose built server entry is missing', async () => {
  await withFixture(async (projectRoot) => {
    // Given
    await rm(join(projectRoot, 'dist/server/entry.mjs'));

    // When
    const packaging = packageRelease({ projectRoot, output: join(projectRoot, 'release') });

    // Then
    await assert.rejects(packaging, /dist\/server\/entry\.mjs.*missing/u);
  });
});

test('refuses output paths that overlap package inputs', async () => {
  await withFixture(async (projectRoot) => {
    // Given
    const output = join(projectRoot, 'dist', 'release');

    // When
    const packaging = packageRelease({ projectRoot, output });

    // Then
    await assert.rejects(packaging, /overlaps package input/u);
  });
});

test('refuses symlinks in selected package inputs when the platform supports them', async (context) => {
  await withFixture(async (projectRoot) => {
    // Given
    const linkPath = join(projectRoot, 'dist/client/assets/linked.css');
    try {
      await symlink(join(projectRoot, 'dist/client/assets/site.css'), linkPath, 'file');
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        context.skip('Creating symlinks is not permitted on this platform');
        return;
      }
      throw error;
    }

    // When
    const packaging = packageRelease({ projectRoot, output: join(projectRoot, 'release') });

    // Then
    await assert.rejects(packaging, /symlink/u);
  });
});

test('cleans its temporary sibling after a copy failure', async () => {
  await withFixture(async (projectRoot) => {
    // Given
    await rm(join(projectRoot, 'scripts/provision-admin.mjs'));
    const output = join(projectRoot, 'artifacts', 'release');

    // When
    const packaging = packageRelease({ projectRoot, output });

    // Then
    await assert.rejects(packaging, /scripts\/provision-admin\.mjs.*missing/u);
    const siblings = await readdir(dirname(output)).catch(() => []);
    assert.deepEqual(siblings, []);
    await assert.rejects(lstat(output), /ENOENT/u);
  });
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { packageRelease } from '../scripts/package-release.mjs';

const fixtureFiles = {
  'app.js': "import './dist/server/entry.mjs';\n",
  'dist/client/assets/site.css': 'body { color: black; }\n',
  'dist/client/index.html': '<!doctype html>\n',
  'dist/server/entry.mjs': "console.log('server');\n",
  'dist/server/chunks/login_A1b2C3.mjs': "import './password_D4e5F6.mjs';\n",
  'dist/server/chunks/password_D4e5F6.mjs': 'export const verifyPassword = true;\n',
  'package-lock.json': '{"lockfileVersion":3}\n',
  'package.json': '{"name":"fixture","version":"2.4.0","type":"module","engines":{"node":">=22.12.0"},"dependencies":{"nodemailer":"^9.1.1"}}\n',
  'docs/production-release-runbook.md': '# Production Release Runbook\n',
  'postgres/migrations/0001_initial.sql': 'select 1;\n',
  'scripts/postgres-migrate.mjs': 'export const migrate = true;\n',
  'scripts/provision-admin.mjs': 'export const provision = true;\n',
  'scripts/contact-retention-purge.mjs': 'export const purge = true;\n',
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
    assert.equal(manifest.format, 'miracon-release/v1');
    assert.equal(manifest.applicationVersion, '2.4.0');
    assert.equal(manifest.createdAt, createdAt.toISOString());
    assert.equal(manifest.nodeEngine, '>=22.12.0');
    assert.equal(paths.includes('release-manifest.json'), false);
    assert.equal(paths.includes('tmp/.gitkeep'), true);
    const packagedPackage = JSON.parse(await readFile(join(output, 'package.json'), 'utf8'));
    assert.equal(packagedPackage.dependencies.nodemailer, '^9.1.1');
    for (const requiredPath of [
      'app.js', 'dist/server/entry.mjs', 'dist/server/chunks/login_A1b2C3.mjs',
      'dist/server/chunks/password_D4e5F6.mjs', 'package.json', 'package-lock.json', 'docs/production-release-runbook.md',
      'postgres/migrations/0001_initial.sql',
      'scripts/postgres-migrate.mjs', 'scripts/provision-admin.mjs', 'scripts/contact-retention-purge.mjs',
      'scripts/supabase-import.mjs',
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

test('packages every ordered migration even when its name describes credential columns', async () => {
  await withFixture(async (projectRoot) => {
    // Given
    const credentialNamedMigrations = [
      'postgres/migrations/0006_tighten_admin_password_hash.sql',
      'postgres/migrations/0007_rotate_session_tokens.sql',
      'postgres/migrations/0008_admin_credentials_audit.sql',
    ];
    for (const relativePath of credentialNamedMigrations) {
      await writeFile(join(projectRoot, ...relativePath.split('/')), 'select 1;\n');
    }
    const output = join(projectRoot, 'release-output');

    // When
    await packageRelease({ projectRoot, output });

    // Then
    const manifest = JSON.parse(await readFile(join(output, 'release-manifest.json'), 'utf8'));
    const paths = manifest.files.map((file) => file.path);
    for (const relativePath of credentialNamedMigrations) {
      assert.equal(paths.includes(relativePath), true, `${relativePath} must be packaged`);
    }
    const packagedMigrations = paths.filter((path) => path.startsWith('postgres/migrations/'));
    assert.deepEqual(packagedMigrations, [
      'postgres/migrations/0001_initial.sql',
      ...credentialNamedMigrations,
    ].sort());
    assert.equal(paths.includes('postgres/migrations/.env'), false);
  });
});

test('still excludes non-migration secrets inside the migrations directory', async () => {
  await withFixture(async (projectRoot) => {
    // Given
    for (const [relativePath, contents] of [
      ['postgres/migrations/.env', 'DATABASE_URL=postgresql://user:pass@localhost/db\n'],
      ['postgres/migrations/deploy.key', 'PRIVATE KEY\n'],
      ['postgres/migrations/apply.log', 'applied\n'],
      ['postgres/migrations/0009_notes_password.sql.bak', 'select 1;\n'],
    ]) {
      await writeFile(join(projectRoot, ...relativePath.split('/')), contents);
    }
    const output = join(projectRoot, 'release-output');

    // When
    await packageRelease({ projectRoot, output });

    // Then
    const manifest = JSON.parse(await readFile(join(output, 'release-manifest.json'), 'utf8'));
    const paths = manifest.files.map((file) => file.path);
    for (const forbiddenPath of [
      'postgres/migrations/.env',
      'postgres/migrations/deploy.key',
      'postgres/migrations/apply.log',
      'postgres/migrations/0009_notes_password.sql.bak',
    ]) assert.equal(paths.includes(forbiddenPath), false, `${forbiddenPath} must not be packaged`);
    assert.equal(paths.includes('postgres/migrations/0001_initial.sql'), true);
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
      'dist/server/.env.smtp',
      'dist/server/smtp-credentials.json',
      'dist/server/chunks/passwords.json',
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
      'dist/server/.agents/session.json',
      'dist/server/.codegraph/index.db',
      'dist/server/.idea/workspace.xml',
      'dist/server/.vscode/settings.json',
      'dist/server/artifacts/local-state.json',
      'dist/server/browser-tests/contact.test.mjs',
      'dist/server/contact-tests/contact.test.ts',
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
    await packageRelease({ projectRoot, output, createdAt: new Date('2026-08-12T10:00:00.000Z') });
    await writeFile(join(projectRoot, 'app.js'), "import './dist/server/entry.mjs'; // updated\n");

    // When
    await packageRelease({ projectRoot, output, force: true, createdAt: new Date('2026-08-13T10:00:00.000Z') });

    // Then
    const manifest = JSON.parse(await readFile(join(output, 'release-manifest.json'), 'utf8'));
    assert.equal(manifest.createdAt, '2026-08-13T10:00:00.000Z');
    assert.equal(await readFile(join(output, 'app.js'), 'utf8'), "import './dist/server/entry.mjs'; // updated\n");
  });
});

test('refuses forced replacement of protected workspace paths without changing their bytes', async () => {
  await withFixture(async (projectRoot) => {
    // Given
    for (const relativePath of ['.git/HEAD', 'src/index.ts', 'public/index.html']) {
      const destination = join(projectRoot, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, `${relativePath}\n`);
    }
    const targets = [
      [projectRoot, join(projectRoot, 'app.js')],
      [join(projectRoot, '.git'), join(projectRoot, '.git/HEAD')],
      [join(projectRoot, 'src'), join(projectRoot, 'src/index.ts')],
      [join(projectRoot, 'public'), join(projectRoot, 'public/index.html')],
      [join(projectRoot, 'dist'), join(projectRoot, 'dist/server/entry.mjs')],
      [join(projectRoot, 'docs'), join(projectRoot, 'docs/production-release-runbook.md')],
      [join(projectRoot, 'postgres'), join(projectRoot, 'postgres/migrations/0001_initial.sql')],
      [join(projectRoot, 'postgres/migrations'), join(projectRoot, 'postgres/migrations/0001_initial.sql')],
      [join(projectRoot, 'scripts'), join(projectRoot, 'scripts/postgres-migrate.mjs')],
      [join(projectRoot, 'scripts/migration'), join(projectRoot, 'scripts/migration/import-artifacts.mjs')],
    ];

    for (const [output, sentinel] of targets) {
      const before = createHash('sha256').update(await readFile(sentinel)).digest('hex');

      // When
      const packaging = packageRelease({ projectRoot, output, force: true });

      // Then
      await assert.rejects(packaging, /protected project path|overlaps package input/u);
      const after = createHash('sha256').update(await readFile(sentinel)).digest('hex');
      assert.equal(after, before, `${output} must remain byte-identical`);
    }
  });
});

test('refuses forced replacement of an arbitrary non-release directory', async () => {
  await withFixture(async (projectRoot) => {
    // Given
    const output = join(projectRoot, 'customer-files');
    await mkdir(output);
    await writeFile(join(output, 'keep.txt'), 'keep\n');

    // When
    const packaging = packageRelease({ projectRoot, output, force: true });

    // Then
    await assert.rejects(packaging, /recognized Miracon release package/u);
    assert.equal(await readFile(join(output, 'keep.txt'), 'utf8'), 'keep\n');
  });
});

test('refuses forced replacement when the release ownership marker is malformed', async () => {
  await withFixture(async (projectRoot) => {
    // Given
    const output = join(projectRoot, 'release');
    await mkdir(output);
    await writeFile(join(output, 'release-manifest.json'), JSON.stringify({ format: 'not-miracon', version: 1, files: [] }));

    // When
    const packaging = packageRelease({ projectRoot, output, force: true });

    // Then
    await assert.rejects(packaging, /recognized Miracon release package/u);
    const manifest = JSON.parse(await readFile(join(output, 'release-manifest.json'), 'utf8'));
    assert.equal(manifest.format, 'not-miracon');
  });
});

test('refuses forced replacement when an owned manifest omits required release entries', async () => {
  await withFixture(async (projectRoot) => {
    // Given
    const output = join(projectRoot, 'release');
    await packageRelease({ projectRoot, output });
    const manifestPath = join(output, 'release-manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.files = manifest.files.filter((file) => file.path !== 'app.js');
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    // When
    const packaging = packageRelease({ projectRoot, output, force: true });

    // Then
    await assert.rejects(packaging, /recognized Miracon release package/u);
    assert.equal(await readFile(join(output, 'app.js'), 'utf8'), fixtureFiles['app.js']);
  });
});

test('refuses forced replacement when an owned manifest contains noncanonical paths', async () => {
  await withFixture(async (projectRoot) => {
    // Given
    const output = join(projectRoot, 'release');
    await packageRelease({ projectRoot, output });
    const manifestPath = join(output, 'release-manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const appEntry = manifest.files.find((file) => file.path === 'app.js');
    manifest.files.push({ ...appEntry, path: './app.js' });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    // When
    const packaging = packageRelease({ projectRoot, output, force: true });

    // Then
    await assert.rejects(packaging, /recognized Miracon release package/u);
    assert.equal(await readFile(join(output, 'app.js'), 'utf8'), fixtureFiles['app.js']);
  });
});

test('refuses a symlink output before forced replacement when the platform supports it', async (context) => {
  await withFixture(async (projectRoot) => {
    // Given
    const ownedDirectory = join(projectRoot, 'owned-directory');
    const output = join(projectRoot, 'release-link');
    await mkdir(ownedDirectory);
    await writeFile(join(ownedDirectory, 'keep.txt'), 'keep\n');
    try {
      await symlink(ownedDirectory, output, 'junction');
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        context.skip('Creating symlinks is not permitted on this platform');
        return;
      }
      throw error;
    }

    // When
    const packaging = packageRelease({ projectRoot, output, force: true });

    // Then
    await assert.rejects(packaging, /symlink/u);
    assert.equal(await readFile(join(ownedDirectory, 'keep.txt'), 'utf8'), 'keep\n');
  });
});

test('uses the copy fallback when Windows-style rename errors occur', async () => {
  await withFixture(async (projectRoot) => {
    // Given
    const output = join(projectRoot, 'release');
    await packageRelease({ projectRoot, output });
    await writeFile(join(projectRoot, 'app.js'), "import './dist/server/entry.mjs'; // fallback\n");
    let fallbackCopies = 0;
    const fileSystem = {
      rename: async (from, to) => {
        if (from.includes('.release.tmp-')) {
          const error = new Error('simulated Windows rename failure');
          error.code = 'EPERM';
          throw error;
        }
        await rename(from, to);
      },
      copy: async (from, to, options) => {
        fallbackCopies += 1;
        await cp(from, to, options);
      },
      remove: rm,
    };

    // When
    await packageRelease({ projectRoot, output, force: true, fileSystem });

    // Then
    assert.equal(fallbackCopies, 1);
    assert.equal(await readFile(join(output, 'app.js'), 'utf8'), "import './dist/server/entry.mjs'; // fallback\n");
  });
});

test('restores the recognized prior release when fallback copy fails', async () => {
  await withFixture(async (projectRoot) => {
    // Given
    const output = join(projectRoot, 'release');
    await packageRelease({ projectRoot, output, createdAt: new Date('2026-08-12T10:00:00.000Z') });
    const previousManifest = await readFile(join(output, 'release-manifest.json'), 'utf8');
    await writeFile(join(projectRoot, 'app.js'), "import './dist/server/entry.mjs'; // must roll back\n");
    const fileSystem = {
      rename: async (from, to) => {
        if (from.includes('.release.tmp-')) {
          const error = new Error('simulated cross-device rename');
          error.code = 'EXDEV';
          throw error;
        }
        await rename(from, to);
      },
      copy: async () => {
        throw new Error('simulated fallback copy failure');
      },
      remove: rm,
    };

    // When
    const packaging = packageRelease({ projectRoot, output, force: true, fileSystem });

    // Then
    await assert.rejects(packaging, /simulated fallback copy failure/u);
    assert.equal(await readFile(join(output, 'release-manifest.json'), 'utf8'), previousManifest);
    assert.equal(await readFile(join(output, 'app.js'), 'utf8'), fixtureFiles['app.js']);
    const siblings = await readdir(dirname(output));
    assert.equal(siblings.some((name) => name.includes('.release.tmp-') || name.includes('.release.backup-')), false);
  });
});

test('restores the prior release when initial temporary cleanup fails after promotion failure', async () => {
  await withFixture(async (projectRoot) => {
    // Given
    const output = join(projectRoot, 'release');
    await packageRelease({ projectRoot, output, createdAt: new Date('2026-08-12T10:00:00.000Z') });
    const previousManifest = await readFile(join(output, 'release-manifest.json'), 'utf8');
    await writeFile(join(projectRoot, 'app.js'), "import './dist/server/entry.mjs'; // cleanup must not block rollback\n");
    const warnings = [];
    let temporaryCleanupAttempts = 0;
    const fileSystem = {
      rename: async (from, to) => {
        if (from.includes('.release.tmp-')) {
          const error = new Error('simulated cross-device promotion');
          error.code = 'EXDEV';
          throw error;
        }
        await rename(from, to);
      },
      copy: async () => {
        throw new Error('simulated promotion copy failure');
      },
      remove: async (path, options) => {
        if (path.includes('.release.tmp-')) {
          temporaryCleanupAttempts += 1;
          if (temporaryCleanupAttempts === 1) throw new Error('simulated initial temporary cleanup failure');
        }
        await rm(path, options);
      },
    };

    // When
    const packaging = packageRelease({ projectRoot, output, force: true, fileSystem, warn: (message) => warnings.push(message) });

    // Then
    await assert.rejects(packaging, /simulated promotion copy failure/u);
    assert.equal(await readFile(join(output, 'release-manifest.json'), 'utf8'), previousManifest);
    assert.equal(await readFile(join(output, 'app.js'), 'utf8'), fixtureFiles['app.js']);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /temporary package could not be removed before rollback/u);
    const siblings = await readdir(dirname(output));
    assert.equal(siblings.some((name) => name.includes('.release.tmp-') || name.includes('.release.backup-')), false);
  });
});

test('restores the recognized prior release when fallback source cleanup partially fails', async () => {
  await withFixture(async (projectRoot) => {
    // Given
    const output = join(projectRoot, 'release');
    await packageRelease({ projectRoot, output, createdAt: new Date('2026-08-12T10:00:00.000Z') });
    const previousManifest = await readFile(join(output, 'release-manifest.json'), 'utf8');
    let sourceCleanupFailed = false;
    const fileSystem = {
      rename: async (from, to) => {
        if (from === output) {
          const error = new Error('simulated locked release directory');
          error.code = 'EPERM';
          throw error;
        }
        await rename(from, to);
      },
      copy: cp,
      remove: async (path, options) => {
        await rm(path, options);
        if (path === output && !sourceCleanupFailed) {
          sourceCleanupFailed = true;
          throw new Error('simulated partial source cleanup failure');
        }
      },
    };

    // When
    const packaging = packageRelease({ projectRoot, output, force: true, fileSystem });

    // Then
    await assert.rejects(packaging, /simulated partial source cleanup failure/u);
    assert.equal(await readFile(join(output, 'release-manifest.json'), 'utf8'), previousManifest);
    assert.equal(await readFile(join(output, 'app.js'), 'utf8'), fixtureFiles['app.js']);
    const siblings = await readdir(dirname(output));
    assert.equal(siblings.some((name) => name.includes('.release.tmp-') || name.includes('.release.backup-')), false);
  });
});

test('keeps the new release usable when obsolete backup cleanup fails', async () => {
  await withFixture(async (projectRoot) => {
    // Given
    const output = join(projectRoot, 'release');
    await packageRelease({ projectRoot, output });
    await writeFile(join(projectRoot, 'app.js'), "import './dist/server/entry.mjs'; // cleanup warning\n");
    const warnings = [];
    const fileSystem = {
      rename,
      copy: cp,
      remove: async (path, options) => {
        if (path.includes('.release.backup-')) throw new Error('simulated backup cleanup failure');
        await rm(path, options);
      },
    };

    // When
    await packageRelease({ projectRoot, output, force: true, fileSystem, warn: (message) => warnings.push(message) });

    // Then
    assert.equal(await readFile(join(output, 'app.js'), 'utf8'), "import './dist/server/entry.mjs'; // cleanup warning\n");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /previous-package backup could not be removed/u);
  });
});

test('preserves a usable output and prior backup when rollback restoration fails', async () => {
  await withFixture(async (projectRoot) => {
    // Given
    const output = join(projectRoot, 'release');
    await packageRelease({ projectRoot, output });
    await writeFile(join(projectRoot, 'app.js'), "import './dist/server/entry.mjs'; // preserved output\n");
    let promotionRenameFailed = false;
    let promotionCopyFailed = false;
    const fileSystem = {
      rename: async (from, to) => {
        if (from.includes('.release.tmp-') && to === output && !promotionRenameFailed) {
          promotionRenameFailed = true;
          const error = new Error('simulated promotion rename failure');
          error.code = 'EXDEV';
          throw error;
        }
        if (from.includes('.release.backup-') && to === output) {
          const error = new Error('simulated restoration rename failure');
          error.code = 'EXDEV';
          throw error;
        }
        await rename(from, to);
      },
      copy: async (from, to, options) => {
        await cp(from, to, options);
        if (!promotionCopyFailed) {
          promotionCopyFailed = true;
          throw new Error('simulated promotion copy completion ambiguity');
        }
        if (from.includes('.release.backup-')) throw new Error('simulated restoration copy failure');
      },
      remove: rm,
    };

    // When
    const packaging = packageRelease({ projectRoot, output, force: true, fileSystem });

    // Then
    await assert.rejects(packaging, /simulated restoration copy failure/u);
    assert.equal(await readFile(join(output, 'app.js'), 'utf8'), "import './dist/server/entry.mjs'; // preserved output\n");
    const backup = (await readdir(dirname(output))).find((name) => name.includes('.release.backup-'));
    assert.ok(backup);
    assert.equal(await readFile(join(dirname(output), backup, 'app.js'), 'utf8'), fixtureFiles['app.js']);
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

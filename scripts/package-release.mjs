import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { fileURLToPath } from 'node:url';

const requiredInputs = [
  'app.js',
  'dist',
  'package.json',
  'package-lock.json',
  'docs/production-release-runbook.md',
  'postgres/migrations',
  'scripts/postgres-migrate.mjs',
  'scripts/provision-admin.mjs',
  'scripts/contact-retention-purge.mjs',
  'scripts/supabase-import.mjs',
  'scripts/verify-media-state.mjs',
  'scripts/migration/import-artifacts.mjs',
  'scripts/migration/import-database.mjs',
  'scripts/migration/import-preparation.mjs',
  'scripts/migration/media-paths.mjs',
  'scripts/migration/media-filesystem.mjs',
  'scripts/migration/media-state-verifier.mjs',
  'scripts/migration/parity-report.mjs',
  'scripts/migration/postgres-import.mjs',
  'scripts/migration/transfer-contract.mjs',
  'scripts/migration/validate-transfer.mjs',
];
const forbiddenSegments = new Set([
  '.agents', '.codegraph', '.git', '.idea', '.omo', '.opencode', '.playwright-mcp', '.slim', '.vercel', '.vscode',
  'artifacts', 'browser-tests', 'contact-tests', 'coverage', 'deploy-artifacts', 'exports',
  'fixtures', 'logs', 'node_modules', 'playwright-report', 'public', 'qa-artifacts', 'qa-output',
  'release-tests', 'temp', 'test-fixtures', 'test-results', 'tests', 'tmp', 'worker',
]);
const migrationFilePattern = /^postgres\/migrations\/\d{4}_[a-z0-9_]+\.sql$/u;
const generatedServerChunkPattern = /^dist\/server\/chunks\/[^/]+\.mjs$/u;
const forbiddenNamePatterns = [
  /^\.env(?:\..*)?$/u,
  /^\.(?:netrc|npmrc|pypirc|yarnrc)$/u,
  /(?:^|[-_.])credentials?(?:[-_.]|$)/u,
  /(?:^|[-_.])passwords?(?:[-_.]|$)/u,
  /(?:^|[-_.])secrets?(?:[-_.]|$)/u,
  /(?:^|[-_.])service[-_.]?role(?:[-_.]|$)/u,
  /(?:^|[-_.])tokens?(?:[-_.]|$)/u,
  /(?:^|[-_.])private[-_.]?key(?:[-_.]|$)/u,
  /(?:^|[-_.])id_(?:dsa|ecdsa|ed25519|rsa)(?:\.|$)/u,
  /\.(?:key|p12|pfx|pem)$/u,
  /\.(?:bak|har|tmp|trace)$/u,
  /\.log$/u,
];
const releaseFormat = 'miracon-release/v1';
const protectedProjectPaths = ['.git', 'src', 'public'];
const requiredReleaseFiles = [
  ...requiredInputs.filter((path) => path !== 'dist' && path !== 'postgres/migrations'),
  'dist/server/entry.mjs',
  'tmp/.gitkeep',
];

export class ReleasePackagingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReleasePackagingError';
  }
}

export async function packageRelease(options) {
  const projectRoot = resolve(options.projectRoot);
  const output = resolve(projectRoot, options.output);
  const createdAt = options.createdAt ?? new Date();
  const force = options.force ?? false;
  const warn = options.warn ?? console.warn;
  const fileSystem = {
    rename,
    copy: cp,
    remove: rm,
    ...options.fileSystem,
  };
  const inputPaths = requiredInputs.map((path) => resolve(projectRoot, path));
  assertSafeOutput(projectRoot, output, inputPaths);
  const outputStats = await lstatIfExists(output);
  const outputExists = outputStats !== null;
  if (outputExists && !force) {
    throw new ReleasePackagingError(`Release output already exists: ${output}`);
  }
  if (outputExists) await assertReplaceableOutput(output, outputStats);
  await assertInputs(projectRoot);

  const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
  const candidates = await collectCandidates(projectRoot);
  const temporary = join(dirname(output), `.${basename(output)}.tmp-${process.pid}-${randomUUID()}`);
  const backup = join(dirname(output), `.${basename(output)}.backup-${process.pid}-${randomUUID()}`);
  const displaced = join(dirname(output), `.${basename(output)}.displaced-${process.pid}-${randomUUID()}`);
  let previousMoved = false;

  const safeMove = async (from, to) => {
    try {
      await fileSystem.rename(from, to);
    } catch (err) {
      if (err?.code === 'EPERM' || err?.code === 'EXDEV') {
        await fileSystem.copy(from, to, { recursive: true });
        await fileSystem.remove(from, { recursive: true, force: true });
        return;
      }
      throw err;
    }
  };

  try {
    await mkdir(temporary, { recursive: true });
    const files = [];
    for (const relativePath of candidates) {
      files.push(await copyAndHash(projectRoot, temporary, relativePath));
    }
    const placeholder = 'tmp/.gitkeep';
    await mkdir(join(temporary, 'tmp'), { recursive: true });
    await writeFile(join(temporary, 'tmp/.gitkeep'), '');
    files.push({ path: placeholder, bytes: 0, sha256: createHash('sha256').digest('hex') });
    files.sort((left, right) => left.path.localeCompare(right.path, 'en'));

    const manifest = {
      format: releaseFormat,
      version: 1,
      applicationVersion: packageJson.version ?? null,
      createdAt: createdAt.toISOString(),
      nodeEngine: packageJson.engines?.node ?? null,
      files,
    };
    await writeFile(join(temporary, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });

    if (outputExists) {
      await safeMove(output, backup);
      previousMoved = true;
    }
    await safeMove(temporary, output);
    if (previousMoved) {
      try {
        await fileSystem.remove(backup, { recursive: true, force: true });
      } catch (error) {
        warn(`Release created, but its previous-package backup could not be removed: ${backup}`);
      }
    }
    return manifest;
  } catch (error) {
    try {
      await fileSystem.remove(temporary, { recursive: true, force: true });
    } catch (cleanupError) {
      warn(`Failed temporary package could not be removed before rollback; restoration will continue: ${temporary}`);
    }
    if (previousMoved) {
      if (!(await isRecognizedReleaseOutput(backup))) throw error;
      let displacedOutputPath;
      if (await pathExists(output)) {
        displacedOutputPath = await pathExists(temporary) ? displaced : temporary;
        await safeMove(output, displacedOutputPath);
      }
      try {
        await safeMove(backup, output);
      } catch (restoreError) {
        if (displacedOutputPath) {
          if (await pathExists(output)) await fileSystem.remove(output, { recursive: true, force: true });
          await safeMove(displacedOutputPath, output);
        }
        throw restoreError;
      }
      if (displacedOutputPath) {
        try {
          await fileSystem.remove(displacedOutputPath, { recursive: true, force: true });
        } catch (cleanupError) {
          warn(`Release rollback completed, but its displaced-output backup could not be removed: ${displacedOutputPath}`);
        }
      }
    } else if (await pathExists(backup)) {
      if (!(await isRecognizedReleaseOutput(backup))) {
        await fileSystem.remove(backup, { recursive: true, force: true });
      } else if (await isRecognizedReleaseOutput(output)) {
        await fileSystem.remove(backup, { recursive: true, force: true });
      } else {
        if (await pathExists(output)) await fileSystem.remove(output, { recursive: true, force: true });
        await safeMove(backup, output);
      }
    }
    if (await pathExists(temporary)) {
      try {
        await fileSystem.remove(temporary, { recursive: true, force: true });
      } catch (cleanupError) {
        warn(`Release rollback completed, but its failed temporary package could not be removed: ${temporary}`);
      }
    }
    throw error;
  }
}

function assertSafeOutput(projectRoot, output, inputPaths) {
  for (const input of inputPaths) {
    if (containsPath(input, output) || containsPath(output, input)) {
      throw new ReleasePackagingError(`Release output overlaps package input: ${output}`);
    }
  }
  for (const protectedPath of protectedProjectPaths.map((path) => resolve(projectRoot, path))) {
    if (containsPath(protectedPath, output) || containsPath(output, protectedPath)) {
      throw new ReleasePackagingError(`Release output overlaps a protected project path: ${output}`);
    }
  }
}

function containsPath(parent, child) {
  const relation = relative(parent, child);
  return relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation));
}

async function assertInputs(projectRoot) {
  for (const relativePath of requiredInputs) {
    const source = join(projectRoot, relativePath);
    let stats;
    try {
      stats = await lstat(source);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new ReleasePackagingError(`Required package input ${relativePath.replaceAll('\\', '/')} is missing`);
      }
      throw error;
    }
    if (stats.isSymbolicLink()) {
      throw new ReleasePackagingError(`Package input contains a symlink: ${relativePath.replaceAll('\\', '/')}`);
    }
  }
  const builtEntry = join(projectRoot, 'dist/server/entry.mjs');
  if (!(await pathExists(builtEntry))) {
    throw new ReleasePackagingError('Required built entry dist/server/entry.mjs is missing; run npm run build first');
  }
}

async function assertReplaceableOutput(output, outputStats) {
  const invalidOutput = () => new ReleasePackagingError(`Forced replacement requires a recognized Miracon release package: ${output}`);
  if (outputStats.isSymbolicLink()) throw new ReleasePackagingError(`Release output must not be a symlink: ${output}`);
  if (!outputStats.isDirectory()) throw invalidOutput();

  let manifest;
  try {
    const manifestPath = join(output, 'release-manifest.json');
    const manifestStats = await lstat(manifestPath);
    if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) throw invalidOutput();
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    if (error instanceof ReleasePackagingError) throw error;
    throw invalidOutput();
  }

  if (
    manifest?.format !== releaseFormat || manifest.version !== 1 ||
    !(manifest.applicationVersion === null || typeof manifest.applicationVersion === 'string') ||
    typeof manifest.createdAt !== 'string' || Number.isNaN(Date.parse(manifest.createdAt)) ||
    !(manifest.nodeEngine === null || typeof manifest.nodeEngine === 'string') ||
    !Array.isArray(manifest.files)
  ) throw invalidOutput();
  const paths = new Set();
  for (const file of manifest.files) {
    const pathSegments = typeof file?.path === 'string' ? file.path.split('/') : [];
    if (
      !file || typeof file.path !== 'string' || file.path === '' || file.path.startsWith('/') ||
      file.path.includes('\\') || pathSegments.some((segment) => segment === '' || segment === '.' || segment === '..') ||
      paths.has(file.path) ||
      !Number.isSafeInteger(file.bytes) || file.bytes < 0 ||
      typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(file.sha256)
    ) throw invalidOutput();
    paths.add(file.path);
    const packageFile = join(output, ...file.path.split('/'));
    const stats = await lstatIfExists(packageFile);
    if (!stats?.isFile() || stats.isSymbolicLink() || stats.size !== file.bytes) throw invalidOutput();
    if (await hashFile(packageFile) !== file.sha256) throw invalidOutput();
  }
  if (requiredReleaseFiles.some((path) => !paths.has(path))) throw invalidOutput();
  if (![...paths].some((path) => migrationFilePattern.test(path))) throw invalidOutput();
}

async function isRecognizedReleaseOutput(output) {
  const outputStats = await lstatIfExists(output);
  if (!outputStats) return false;
  try {
    await assertReplaceableOutput(output, outputStats);
    return true;
  } catch (error) {
    if (error instanceof ReleasePackagingError) return false;
    throw error;
  }
}

async function collectCandidates(projectRoot) {
  const candidates = [];
  for (const relativePath of requiredInputs) {
    await walkInput(projectRoot, relativePath, candidates);
  }
  return candidates.sort((left, right) => left.localeCompare(right, 'en'));
}

async function walkInput(projectRoot, relativePath, candidates) {
  const source = join(projectRoot, relativePath);
  const stats = await lstat(source);
  const manifestPath = relativePath.replaceAll('\\', '/');
  if (stats.isSymbolicLink()) {
    throw new ReleasePackagingError(`Package input contains a symlink: ${manifestPath}`);
  }
  if (isForbidden(manifestPath)) return;
  if (stats.isFile()) {
    candidates.push(manifestPath);
    return;
  }
  if (!stats.isDirectory()) {
    throw new ReleasePackagingError(`Package input is not a regular file or directory: ${manifestPath}`);
  }
  const entries = await readdir(source);
  entries.sort((left, right) => left.localeCompare(right, 'en'));
  for (const entry of entries) await walkInput(projectRoot, join(relativePath, entry), candidates);
}

function isForbidden(relativePath) {
  const normalized = relativePath.toLowerCase();
  const segments = normalized.split('/');
  if (segments.some((segment) => forbiddenSegments.has(segment))) return true;
  // Ordered SQL migrations are schema definitions, never credential material. Their
  // filenames legitimately describe credential-related columns (for example
  // 0006_tighten_admin_password_hash.sql), and dropping one silently breaks the
  // runner's exact-prefix ledger preflight on a fresh environment.
  if (migrationFilePattern.test(normalized)) return false;
  if (generatedServerChunkPattern.test(normalized)) return false;
  return forbiddenNamePatterns.some((pattern) => pattern.test(segments.at(-1)));
}

async function copyAndHash(projectRoot, temporary, relativePath) {
  const source = join(projectRoot, ...relativePath.split('/'));
  const destination = join(temporary, ...relativePath.split('/'));
  await mkdir(dirname(destination), { recursive: true });
  const hash = createHash('sha256');
  let bytes = 0;
  const hasher = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(createReadStream(source), hasher, createWriteStream(destination, { flags: 'wx' }));
  return { path: relativePath, bytes, sha256: hash.digest('hex') };
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function lstatIfExists(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function parseArguments(argumentsList) {
  let force = false;
  let output;
  for (const argument of argumentsList) {
    if (argument === '--force') {
      force = true;
    } else if (!output) {
      output = argument;
    } else {
      throw new ReleasePackagingError('Usage: node scripts/package-release.mjs [OUTPUT] [--force]');
    }
  }
  return { force, output: output ?? 'release-output' };
}

const entryPath = process.argv[1];
if (entryPath && fileURLToPath(import.meta.url) === resolve(entryPath)) {
  const projectRoot = fileURLToPath(new URL('../', import.meta.url));
  packageRelease({ projectRoot, ...parseArguments(process.argv.slice(2)) })
    .then(() => console.log('Release package created.'))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'Release packaging failed');
      process.exitCode = 1;
    });
}

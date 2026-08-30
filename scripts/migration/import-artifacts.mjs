import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CONTRACT_VERSION } from './transfer-contract.mjs';
import { PostgresImportError } from './import-preparation.mjs';

const migrationPattern = /^\d{4}_[a-z0-9_]+\.sql$/u;

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new PostgresImportError(`${label} must contain valid JSON`);
    throw error;
  }
}

async function migrationChecksums(directory) {
  const filenames = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  if (filenames.length === 0 || filenames.some((name) => !migrationPattern.test(name))) throw new PostgresImportError('Target migration files are invalid');
  return Promise.all(filenames.map(async (filename) => ({
    filename, sha256: createHash('sha256').update(await readFile(join(directory, filename))).digest('hex'),
  })));
}

async function validateManifest(inputDirectory, snapshot) {
  const path = join(inputDirectory, 'manifest.json');
  const manifest = await readJson(path, 'Transfer manifest');
  if (manifest.version !== CONTRACT_VERSION || manifest.snapshotId !== snapshot.snapshotId || manifest.contentHash !== snapshot.contentHash) {
    throw new PostgresImportError('Transfer manifest identity does not match snapshot');
  }
  const entry = manifest.files?.find((file) => file.filename === 'snapshot.json');
  const bytes = await readFile(join(inputDirectory, 'snapshot.json'));
  if (!entry || entry.bytes !== bytes.length || entry.sha256 !== createHash('sha256').update(bytes).digest('hex')) {
    throw new PostgresImportError('Snapshot artifact checksum or byte count mismatch');
  }
}

export async function loadImportArtifacts({ inputDirectory, mediaStatePath, migrationsDirectory }) {
  const input = resolve(inputDirectory);
  const snapshot = await readJson(join(input, 'snapshot.json'), 'Snapshot');
  await validateManifest(input, snapshot);
  const [mediaState, targetMigrations] = await Promise.all([
    readJson(resolve(mediaStatePath), 'Media state'), migrationChecksums(resolve(migrationsDirectory)),
  ]);
  return { snapshot, mediaState, targetMigrations };
}

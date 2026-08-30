import { createHash, randomUUID } from 'node:crypto';
import { open, mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshot, buildTransferManifest, canonicalJson } from './migration/transfer-contract.mjs';
import { transformSupabaseSnapshot } from './migration/transform-supabase.mjs';
import { createSupabaseSourceClient, readSupabaseSource } from './migration/supabase-source.mjs';

const defaultMigrationsDirectory = fileURLToPath(new URL('../postgres/migrations/', import.meta.url));
const migrationFilenamePattern = /^\d{4}_[a-z0-9_]+\.sql$/u;

export class SupabaseExportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SupabaseExportError';
  }
}

function sourceHostname(sourceUrl, allowInsecure) {
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new SupabaseExportError('SUPABASE_SOURCE_URL must be a valid URL');
  }
  if (parsed.username || parsed.password) throw new SupabaseExportError('SUPABASE_SOURCE_URL must not contain credentials');
  if (!parsed.hostname || (!allowInsecure && parsed.protocol !== 'https:')) {
    throw new SupabaseExportError('SUPABASE_SOURCE_URL must use HTTPS');
  }
  return parsed.hostname.toLowerCase();
}

async function targetMigrationChecksums(directory) {
  const filenames = (await readdir(directory)).filter((filename) => filename.endsWith('.sql')).sort();
  if (filenames.length === 0 || filenames.some((filename) => !migrationFilenamePattern.test(filename))) {
    throw new SupabaseExportError('PostgreSQL migrations must use ordered NNNN_name.sql filenames');
  }
  return Promise.all(filenames.map(async (filename) => ({
    filename,
    sha256: createHash('sha256').update(await readFile(join(directory, filename))).digest('hex'),
  })));
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function durableWrite(path, text) {
  const handle = await open(path, 'wx');
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path) {
  let handle;
  try {
    handle = await open(path, 'r');
    await handle.sync();
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  } finally {
    await handle?.close();
  }
}

async function writeOutput({ output, snapshotText, manifestText, force, writeArtifact }) {
  const parent = dirname(output);
  const temporary = join(parent, `.${basename(output)}.staging-${process.pid}-${randomUUID()}`);
  const backup = join(parent, `.${basename(output)}.backup-${process.pid}-${randomUUID()}`);
  const outputExists = await pathExists(output);
  if (outputExists && !force) throw new SupabaseExportError(`Export output already exists: ${output}; use --force to replace it`);
  let previousMoved = false;
  try {
    await mkdir(parent, { recursive: true });
    await mkdir(temporary);
    for (const [filename, text] of [['snapshot.json', snapshotText], ['manifest.json', manifestText]]) {
      const defaultWrite = () => durableWrite(join(temporary, filename), text);
      if (writeArtifact) await writeArtifact({ filename, text, defaultWrite });
      else await defaultWrite();
    }
    await syncDirectory(temporary);
    if (outputExists) {
      await rename(output, backup);
      previousMoved = true;
    }
    await rename(temporary, output);
    await syncDirectory(parent);
    if (previousMoved) await rm(backup, { recursive: true });
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    if (previousMoved) {
      if (await pathExists(output)) await rm(output, { recursive: true, force: true });
      await rename(backup, output);
    }
    throw error;
  }
}

async function existingSnapshotId(output) {
  try {
    const snapshot = JSON.parse(await readFile(join(output, 'snapshot.json'), 'utf8'));
    return typeof snapshot.snapshotId === 'string' ? snapshot.snapshotId : null;
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function exportSupabaseContent(options) {
  const output = resolve(options.outputDirectory);
  const sourceIdentifier = sourceHostname(options.sourceUrl, Boolean(options.sourceClient));
  const client = options.sourceClient ?? createSupabaseSourceClient(options.sourceUrl, options.serviceRoleKey);
  const [source, targetMigrations] = await Promise.all([
    readSupabaseSource({ client, pageSize: options.pageSize }),
    targetMigrationChecksums(resolve(options.migrationsDirectory ?? defaultMigrationsDirectory)),
  ]);
  const content = transformSupabaseSnapshot({ ...source, sourceIdentifier, siteOrigins: options.siteOrigins, targetMigrations });
  const timestamp = (options.now?.() ?? new Date()).toISOString();
  const snapshot = buildSnapshot({ content, exportedAt: timestamp });
  const snapshotText = `${canonicalJson(snapshot)}\n`;
  const snapshotFile = { filename: 'snapshot.json', sha256: createHash('sha256').update(snapshotText).digest('hex'), bytes: Buffer.byteLength(snapshotText) };
  const manifest = buildTransferManifest({ snapshot, createdAt: timestamp, files: [snapshotFile] });
  const result = { sourceIdentifier, counts: content.counts, snapshotId: snapshot.snapshotId, outputDirectory: output, snapshotPath: join(output, 'snapshot.json'), manifestPath: join(output, 'manifest.json') };
  if (options.dryRun || options.validate) return { ...result, unchanged: false, written: false };
  const unchanged = options.force && await existingSnapshotId(output) === snapshot.snapshotId;
  if (unchanged) return { ...result, unchanged: true, written: false };
  await writeOutput({ output, snapshotText, manifestText: `${canonicalJson(manifest)}\n`, force: options.force ?? false, writeArtifact: options.writeArtifact });
  return { ...result, unchanged: false, written: true };
}

export function parseExportArguments(argumentsList) {
  const options = { dryRun: false, validate: false, force: false, siteOrigins: [] };
  for (const argument of argumentsList) {
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--validate') options.validate = true;
    else if (argument === '--force') options.force = true;
    else if (argument.startsWith('--output=') && !options.output) options.output = argument.slice(9);
    else if (argument.startsWith('--site-origin=')) options.siteOrigins.push(argument.slice(14));
    else if (argument.startsWith('--page-size=') && options.pageSize === undefined) options.pageSize = Number(argument.slice(12));
    else throw new SupabaseExportError('Usage: node scripts/supabase-export.mjs --output=DIR [--site-origin=ORIGIN] [--page-size=N] [--dry-run|--validate] [--force]');
  }
  if (!options.output) throw new SupabaseExportError('--output=DIR is required');
  return options;
}

async function main() {
  const cli = parseExportArguments(process.argv.slice(2));
  const sourceUrl = process.env.SUPABASE_SOURCE_URL;
  const serviceRoleKey = process.env.SUPABASE_SOURCE_SERVICE_ROLE_KEY;
  if (!sourceUrl || !serviceRoleKey) throw new SupabaseExportError('SUPABASE_SOURCE_URL and SUPABASE_SOURCE_SERVICE_ROLE_KEY are required');
  const siteOrigins = cli.siteOrigins.length > 0 ? cli.siteOrigins : process.env.PUBLIC_SITE_URL ? [process.env.PUBLIC_SITE_URL] : [];
  const result = await exportSupabaseContent({ ...cli, outputDirectory: cli.output, sourceUrl, serviceRoleKey, siteOrigins });
  console.log(JSON.stringify({ sourceHostname: result.sourceIdentifier, counts: result.counts, snapshotId: result.snapshotId, outputPaths: result.written ? [result.snapshotPath, result.manifestPath] : [] }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Supabase export failed');
    process.exitCode = 1;
  });
}

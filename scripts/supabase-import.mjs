import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadImportArtifacts } from './migration/import-artifacts.mjs';
import { importPostgresSnapshot, preparePostgresImport } from './migration/postgres-import.mjs';
import { validateTransfer } from './migration/validate-transfer.mjs';

const defaultMigrations = fileURLToPath(new URL('../postgres/migrations/', import.meta.url));

export class SupabaseImportError extends Error {
  constructor(message) { super(message); this.name = 'SupabaseImportError'; }
}

export function parseImportArguments(argumentsList) {
  const options = { dryRun: false, validate: false, strict: false };
  for (const argument of argumentsList) {
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--validate') options.validate = true;
    else if (argument === '--strict') options.strict = true;
    else if (argument.startsWith('--input=') && !options.input) options.input = argument.slice(8);
    else if (argument.startsWith('--media-state=') && !options.mediaState) options.mediaState = argument.slice(14);
    else throw new SupabaseImportError('Usage: node scripts/supabase-import.mjs --input=DIR --media-state=FILE [--dry-run|--validate [--strict]]');
  }
  if (!options.input || !options.mediaState) throw new SupabaseImportError('--input=DIR and --media-state=FILE are required');
  if (options.dryRun && options.validate) throw new SupabaseImportError('--dry-run and --validate cannot be combined');
  if (options.strict && !options.validate) throw new SupabaseImportError('--strict requires --validate');
  return options;
}

export async function runImportCli(argumentsList, environment, injectedDatabase) {
  const options = parseImportArguments(argumentsList);
  const artifacts = await loadImportArtifacts({ inputDirectory: options.input, mediaStatePath: options.mediaState, migrationsDirectory: defaultMigrations });
  const prepared = preparePostgresImport(artifacts);
  if (options.dryRun && !injectedDatabase) return { snapshotId: prepared.snapshotId, counts: prepared.counts, written: false };
  if (!injectedDatabase && !environment.DATABASE_URL) throw new SupabaseImportError('DATABASE_URL is required');
  const pool = injectedDatabase ?? new pg.Pool({ connectionString: environment.DATABASE_URL, application_name: 'miracon-snapshot-import', connectionTimeoutMillis: 10_000, query_timeout: 60_000, statement_timeout: 60_000 });
  try {
    if (options.validate) return validateTransfer({ database: pool, prepared, strict: options.strict });
    return importPostgresSnapshot({ ...artifacts, database: pool });
  } finally {
    if (!injectedDatabase) await pool.end();
  }
}

async function main() {
  const result = await runImportCli(process.argv.slice(2), process.env);
  console.log(JSON.stringify(result));
  if (result.valid === false) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : 'Snapshot import failed'); process.exitCode = 1; });
}

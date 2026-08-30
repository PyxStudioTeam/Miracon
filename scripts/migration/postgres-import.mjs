import { prepareImport } from './import-preparation.mjs';
import { importPreparedSnapshot } from './import-database.mjs';

export { PostgresImportError } from './import-preparation.mjs';

export function preparePostgresImport(input) {
  return prepareImport(input);
}

export async function importPostgresSnapshot({ snapshot, mediaState, targetMigrations, database, dryRun = false }) {
  const prepared = prepareImport({ snapshot, mediaState, targetMigrations });
  if (dryRun && !database) return { snapshotId: prepared.snapshotId, counts: prepared.counts, written: false };
  if (!database) throw new TypeError('An explicit PostgreSQL Pool or connection is required');
  return importPreparedSnapshot(database, prepared);
}

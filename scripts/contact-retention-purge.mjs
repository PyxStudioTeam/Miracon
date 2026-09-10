import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import pg from 'pg';

export const CONTACT_RETENTION_DAYS = 90;
const USAGE = 'Usage: node scripts/contact-retention-purge.mjs [--apply]';

export class ContactRetentionPurgeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContactRetentionPurgeError';
  }
}

export async function purgeExpiredContacts(database, now) {
  const cutoff = new Date(now.getTime() - CONTACT_RETENTION_DAYS * 86_400_000);
  const result = await database.query(`
    with expired_challenges as (
      delete from miracon.contact_challenges
      where expires_at < $2
    )
    delete from miracon.contact_submissions
    where created_at < $1
  `, [cutoff, now]);
  return { deleted: result.rowCount ?? 0, cutoff: cutoff.toISOString() };
}

export async function runContactRetentionPurgeCli(argumentsList, environment, dependencies = {}) {
  if (argumentsList.length === 1 && argumentsList[0] === '--help') return { usage: USAGE };
  if (argumentsList.some((argument) => argument !== '--apply') || argumentsList.length > 1) {
    throw new ContactRetentionPurgeError(USAGE);
  }
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) throw new ContactRetentionPurgeError('DATABASE_URL is required');
  const createPool = dependencies.createPool ?? ((connectionString) => new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: 'miracon-contact-retention-purge',
  }));
  const database = createPool(databaseUrl);
  try {
    const now = new Date();
    if (argumentsList[0] !== '--apply') {
      const cutoff = new Date(now.getTime() - CONTACT_RETENTION_DAYS * 86_400_000);
      const result = await database.query(
        'select count(*)::integer as count from miracon.contact_submissions where created_at < $1',
        [cutoff],
      );
      return { dryRun: true, candidates: result.rows[0]?.count ?? 0, cutoff: cutoff.toISOString() };
    }
    return { dryRun: false, ...await purgeExpiredContacts(database, now) };
  } finally {
    await database.end();
  }
}

async function main() {
  const result = await runContactRetentionPurgeCli(process.argv.slice(2), process.env);
  console.log('usage' in result ? result.usage : JSON.stringify(result, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Contact retention purge failed');
    process.exitCode = 1;
  });
}

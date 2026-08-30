import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const migrationsDirectory = new URL('../postgres/migrations/', import.meta.url);
const migrationFilenamePattern = /^\d{4}_[a-z0-9_]+\.sql$/u;

class MigrationConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MigrationConfigurationError';
  }
}

class MigrationDriftError extends Error {
  constructor(filename) {
    super(`Applied migration ${filename} no longer matches its recorded checksum`);
    this.name = 'MigrationDriftError';
  }
}

class MigrationHistoryError extends Error {
  constructor(filename) {
    super(`Applied migration ${filename} is missing from the migration directory`);
    this.name = 'MigrationHistoryError';
  }
}

class MigrationOrderError extends Error {
  constructor(filename) {
    super(`Migration ${filename} was introduced before an already-applied migration`);
    this.name = 'MigrationOrderError';
  }
}

async function readMigrations(source) {
  const filenames = (await readdir(source))
    .filter((filename) => filename.endsWith('.sql'))
    .sort();
  if (filenames.length === 0 || filenames.some((filename) => !migrationFilenamePattern.test(filename))) {
    throw new MigrationConfigurationError('PostgreSQL migrations must use ordered NNNN_name.sql filenames');
  }

  return Promise.all(filenames.map(async (filename) => {
    const sql = await readFile(new URL(filename, source), 'utf8');
    return {
      filename,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    };
  }));
}

export function validateMigrationLedger(migrations, ledger) {
  const filesByName = new Map(migrations.map((migration) => [migration.filename, migration]));
  for (const applied of ledger) {
    const migration = filesByName.get(applied.filename);
    if (!migration) {
      throw new MigrationHistoryError(applied.filename);
    }
    if (migration.checksum !== applied.checksum) {
      throw new MigrationDriftError(applied.filename);
    }
  }

  for (const [index, applied] of ledger.entries()) {
    if (migrations[index]?.filename !== applied.filename) {
      throw new MigrationOrderError(migrations[index]?.filename ?? applied.filename);
    }
  }
  return migrations.slice(ledger.length);
}

export async function migrate(databaseUrl, source = migrationsDirectory) {
  if (typeof databaseUrl !== 'string' || databaseUrl.trim() === '') {
    throw new MigrationConfigurationError('DATABASE_URL is required');
  }

  const migrations = await readMigrations(source);
  const client = new pg.Client({
    connectionString: databaseUrl,
    application_name: 'miracon-schema-migrate',
    connectionTimeoutMillis: 10_000,
    query_timeout: 60_000,
    statement_timeout: 60_000,
  });
  await client.connect();
  let locked = false;
  try {
    await client.query(`select pg_advisory_lock(hashtextextended('miracon-schema-migrations', 0))`);
    locked = true;
    await client.query('begin');
    let pending;
    try {
      await client.query(`
        create schema if not exists miracon_meta;
        create table if not exists miracon_meta.schema_migrations (
          filename text primary key,
          checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
          applied_at timestamptz not null default now()
        )
      `);
      const applied = await client.query(`
        select filename, checksum
        from miracon_meta.schema_migrations
        order by filename
      `);
      pending = validateMigrationLedger(migrations, applied.rows);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }

    for (const migration of pending) {
      await client.query('begin');
      try {
        await client.query(migration.sql);
        await client.query(
          'insert into miracon_meta.schema_migrations (filename, checksum) values ($1, $2)',
          [migration.filename, migration.checksum],
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }
  } finally {
    try {
      if (locked) {
        await client.query(`select pg_advisory_unlock(hashtextextended('miracon-schema-migrations', 0))`);
      }
    } finally {
      await client.end();
    }
  }
}

async function main() {
  await migrate(process.env.DATABASE_URL);
  console.log('PostgreSQL migrations are up to date.');
}

const entryPath = process.argv[1];
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

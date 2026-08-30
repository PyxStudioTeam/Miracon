import assert from 'node:assert/strict';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, beforeEach, test } from 'node:test';
import { migrate } from '../../scripts/postgres-migrate.mjs';
import { openClient, requireSafeDatabaseTestUrl, resetSchemas } from './database-test-helpers.mjs';

const databaseUrl = requireSafeDatabaseTestUrl();
const temporaryDirectories = [];
let client;

async function createMigrationSource(entries) {
  const directory = await mkdtemp(join(tmpdir(), 'miracon-migrations-'));
  temporaryDirectories.push(directory);
  await Promise.all(entries.map(({ filename, sql }) => writeFile(join(directory, filename), sql, 'utf8')));
  return { directory, source: pathToFileURL(`${directory}${sep}`) };
}

before(async () => {
  client = await openClient(databaseUrl, 'migration-runner-test');
});

beforeEach(async () => {
  await resetSchemas(client, databaseUrl);
});

after(async () => {
  await client?.end();
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

test('repeat application executes each migration exactly once', async () => {
  // Given
  const { source } = await createMigrationSource([
    { filename: '0001_probe.sql', sql: 'create schema runner_probe; create table runner_probe.first (id integer primary key);' },
  ]);

  // When
  await migrate(databaseUrl, source);
  await migrate(databaseUrl, source);
  const result = await client.query('select filename from miracon_meta.schema_migrations');

  // Then
  assert.deepEqual(result.rows, [{ filename: '0001_probe.sql' }]);
});

test('checksum drift is rejected without changing the ledger', async () => {
  // Given
  const { directory, source } = await createMigrationSource([
    { filename: '0001_probe.sql', sql: 'create schema runner_probe;' },
  ]);
  await migrate(databaseUrl, source);
  await writeFile(join(directory, '0001_probe.sql'), 'create schema runner_probe; select 1;', 'utf8');

  // When / Then
  await assert.rejects(migrate(databaseUrl, source), { name: 'MigrationDriftError' });
  const result = await client.query('select count(*)::integer as count from miracon_meta.schema_migrations');
  assert.equal(result.rows[0].count, 1);
});

test('an applied migration missing from disk is rejected', async () => {
  // Given
  const { directory, source } = await createMigrationSource([
    { filename: '0001_probe.sql', sql: 'create schema runner_probe;' },
    { filename: '0002_table.sql', sql: 'create table runner_probe.second (id integer);' },
  ]);
  await migrate(databaseUrl, source);
  await unlink(join(directory, '0002_table.sql'));

  // When / Then
  await assert.rejects(migrate(databaseUrl, source), { name: 'MigrationHistoryError' });
});

test('a migration introduced before applied history is rejected before SQL runs', async () => {
  // Given
  const { directory, source } = await createMigrationSource([
    { filename: '0001_probe.sql', sql: 'create schema runner_probe;' },
    { filename: '0003_later.sql', sql: 'create table runner_probe.later (id integer);' },
  ]);
  await migrate(databaseUrl, source);
  await writeFile(join(directory, '0002_inserted.sql'), 'create table runner_probe.inserted (id integer);', 'utf8');
  await writeFile(join(directory, '0004_pending.sql'), 'create table runner_probe.pending (id integer);', 'utf8');

  // When
  await assert.rejects(migrate(databaseUrl, source), { name: 'MigrationOrderError' });
  const result = await client.query(`
    select
      to_regclass('runner_probe.inserted') as inserted,
      to_regclass('runner_probe.pending') as pending
  `);

  // Then
  assert.deepEqual(result.rows[0], { inserted: null, pending: null });
});

test('a failed migration rolls back its SQL and ledger row', async () => {
  // Given
  const { source } = await createMigrationSource([
    { filename: '0001_probe.sql', sql: 'create schema runner_probe;' },
    {
      filename: '0002_failure.sql',
      sql: 'create table runner_probe.failed (id integer); select 1 / 0;',
    },
  ]);

  // When
  await assert.rejects(migrate(databaseUrl, source));
  const result = await client.query(`
    select
      (select array_agg(filename order by filename) from miracon_meta.schema_migrations) as filenames,
      to_regclass('runner_probe.failed') as failed_table
  `);

  // Then
  assert.deepEqual(result.rows[0], { filenames: ['0001_probe.sql'], failed_table: null });
});

test('concurrent bootstrap produces one ordered ledger and one schema', async () => {
  // Given
  const { source } = await createMigrationSource([
    { filename: '0001_probe.sql', sql: 'create schema runner_probe;' },
    { filename: '0002_table.sql', sql: 'create table runner_probe.concurrent (id integer);' },
  ]);

  // When
  await Promise.all([migrate(databaseUrl, source), migrate(databaseUrl, source)]);
  const result = await client.query(`
    select
      (select array_agg(filename order by filename) from miracon_meta.schema_migrations) as filenames,
      to_regclass('runner_probe.concurrent')::text as concurrent_table
  `);

  // Then
  assert.deepEqual(result.rows[0], {
    filenames: ['0001_probe.sql', '0002_table.sql'],
    concurrent_table: 'runner_probe.concurrent',
  });
});

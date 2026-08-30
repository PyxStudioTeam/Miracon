import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { migrate } from '../scripts/postgres-migrate.mjs';
import { importPostgresSnapshot, preparePostgresImport } from '../scripts/migration/postgres-import.mjs';
import { validateTransfer } from '../scripts/migration/validate-transfer.mjs';
import { openClient, requireSafeDatabaseTestUrl, resetSchemas } from '../postgres/tests/database-test-helpers.mjs';
import { importFixture } from './fixtures.mjs';

const databaseUrl = requireSafeDatabaseTestUrl();
let client;

before(async () => { client = await openClient(databaseUrl, 'migration-import-test'); });
beforeEach(async () => { await resetSchemas(client, databaseUrl); await migrate(databaseUrl); });
after(async () => { await client?.end(); });

test('imports full snapshot twice with stable content, timestamps, and media identities', async () => {
  const artifacts = await importFixture();
  const prepared = preparePostgresImport(artifacts);

  await importPostgresSnapshot({ ...artifacts, database: client });
  const first = await validateTransfer({ database: client, prepared });
  await importPostgresSnapshot({ ...artifacts, database: client });
  const second = await validateTransfer({ database: client, prepared });
  const counts = await client.query(`select
    (select count(*)::integer from miracon.projects) projects,
    (select count(*)::integer from miracon.project_images) images,
    (select count(*)::integer from miracon.media_files) media`);
  const availability = await client.query('select remaining_units from miracon.projects where id=$1', ['project-1']);

  assert.equal(first.valid, true);
  assert.equal(second.valid, true);
  assert.deepEqual(counts.rows[0], { projects: 1, images: 1, media: prepared.mediaFiles.length });
  assert.equal(availability.rows[0].remaining_units, 0);
});

test('rolls back all snapshot rows and media after a late invalid settings update', async () => {
  const artifacts = await importFixture();
  artifacts.snapshot.content.siteSettings.footer_terms_visible = true;
  artifacts.snapshot.content.siteSettings.footer_terms_pdf_url = '';
  const { sha256 } = await import('../scripts/migration/transfer-contract.mjs');
  artifacts.snapshot.contentHash = sha256(artifacts.snapshot.content);
  artifacts.snapshot.snapshotId = `snapshot-${artifacts.snapshot.contentHash}`;
  artifacts.mediaState.snapshotId = artifacts.snapshot.snapshotId;
  artifacts.mediaState.contentHash = artifacts.snapshot.contentHash;

  await assert.rejects(importPostgresSnapshot({ ...artifacts, database: client }));
  const result = await client.query(`select
    (select count(*)::integer from miracon.projects) projects,
    (select count(*)::integer from miracon.media_files) media`);

  assert.deepEqual(result.rows[0], { projects: 0, media: 0 });
});

test('rejects applied migration checksum drift before snapshot writes', async () => {
  const artifacts = await importFixture();
  await client.query(`update miracon_meta.schema_migrations set checksum=$2 where filename=$1`, [artifacts.targetMigrations[0].filename, '0'.repeat(64)]);

  await assert.rejects(importPostgresSnapshot({ ...artifacts, database: client }), /migration.*checksum/i);
  const result = await client.query('select count(*)::integer as count from miracon.projects');

  assert.equal(result.rows[0].count, 0);
});

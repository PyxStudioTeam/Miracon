import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSnapshot, sha256 } from '../scripts/migration/transfer-contract.mjs';
import { transformSupabaseSnapshot } from '../scripts/migration/transform-supabase.mjs';
import { sourceRows } from '../migration-tests/fixtures.mjs';
import { importPostgresSnapshot, preparePostgresImport } from '../scripts/migration/postgres-import.mjs';
import { parseImportArguments } from '../scripts/supabase-import.mjs';
import { validationArguments } from '../scripts/migration/validate-transfer.mjs';

const hash = '1'.repeat(64);

function fixture(configure = () => {}) {
  const input = structuredClone(sourceRows);
  input.targetMigrations = [{ filename: '0001_content_tables.sql', sha256: hash }];
  const sourceUrl = 'https://fake-project.supabase.co/storage/v1/object/public/project-media/project-1/source.webp';
  const variants = input.projects[0].image_variants.images['/img/cover.webp'];
  input.projects[0].cover_url = sourceUrl;
  input.projects[0].image_variants.images = { [sourceUrl]: variants };
  configure(input, sourceUrl, variants);
  const snapshot = buildSnapshot({ content: transformSupabaseSnapshot(input), exportedAt: '2026-08-12T10:00:00.000Z' });
  const candidates = new Map();
  for (const reference of snapshot.content.mediaReferences.filter((item) => item.transferCandidate)) {
    const key = `${reference.bucket}/${reference.objectPath}`;
    const record = candidates.get(key) ?? {
      key, bucket: reference.bucket, objectPath: reference.objectPath, references: [], status: 'completed',
      bytes: 123, sha256: hash, mimeType: reference.objectPath.endsWith('.pdf') ? 'application/pdf' : reference.objectPath.endsWith('.mp4') ? 'video/mp4' : 'image/webp',
      relativePath: `imports/${reference.bucket}/${hash}-${reference.objectPath.split('/').at(-1)}`,
      relativeUrl: `/media/imports/${reference.bucket}/${hash}-${reference.objectPath.split('/').at(-1)}`,
    };
    record.references.push(reference.originalUrl);
    candidates.set(key, record);
  }
  const mediaState = { version: 'miracon-media-transfer/v1', snapshotId: snapshot.snapshotId, contentHash: snapshot.contentHash, records: [...candidates.values()] };
  return { snapshot, mediaState, targetMigrations: input.targetMigrations };
}

test('prepares exact recursive URL rewrites without replacing prose substrings', () => {
  const { snapshot, mediaState, targetMigrations } = fixture();
  const original = snapshot.content.projects[0].hero_url;
  snapshot.content.projects[0].full_description = `Keep ${original} in prose`;
  snapshot.contentHash = sha256(snapshot.content);
  snapshot.snapshotId = `snapshot-${snapshot.contentHash}`;
  mediaState.snapshotId = snapshot.snapshotId;
  mediaState.contentHash = snapshot.contentHash;

  const prepared = preparePostgresImport({ snapshot, mediaState, targetMigrations });
  const rewrittenCover = prepared.projects[0].cover_url;

  assert.match(prepared.projects[0].hero_url, /^\/media\//u);
  assert.equal(prepared.projects[0].full_description, `Keep ${original} in prose`);
  assert.match(rewrittenCover, /^\/media\//u);
  assert.match(prepared.projects[0].image_variants.images[rewrittenCover].avif[0].src, /^\/media\//u);
  assert.equal(prepared.mediaFiles.length, mediaState.records.length);
});

test('rejects image variant key collisions caused by URL rewriting', () => {
  // Given
  const artifacts = fixture((input, sourceUrl, variants) => {
    input.projects[0].image_variants.images[`${sourceUrl}?download=1`] = structuredClone(variants);
  });

  // When / Then
  assert.throws(() => preparePostgresImport(artifacts), /collision/i);
});

test('rejects incomplete media, content identity drift, and migration checksum drift', () => {
  const incomplete = fixture();
  incomplete.mediaState.records[0].status = 'pending';
  assert.throws(() => preparePostgresImport(incomplete), /completed/i);

  const missing = fixture();
  missing.mediaState.records.shift();
  assert.throws(() => preparePostgresImport(missing), /completed/i);

  const identity = fixture();
  identity.mediaState.contentHash = '2'.repeat(64);
  assert.throws(() => preparePostgresImport(identity), /identity/i);

  const migration = fixture();
  migration.targetMigrations[0].sha256 = '3'.repeat(64);
  assert.throws(() => preparePostgresImport(migration), /migration/i);
});

test('dry run prepares without a database and CLI parses explicit import surfaces', async () => {
  const artifacts = fixture();

  const result = await importPostgresSnapshot({ ...artifacts, dryRun: true });

  assert.equal(result.written, false);
  assert.equal(result.counts.projects, 1);
  assert.deepEqual(parseImportArguments(['--input=export', '--media-state=state.json', '--validate']), {
    input: 'export', mediaState: 'state.json', dryRun: false, validate: true, strict: false,
  });
  assert.deepEqual(validationArguments(['--input=export', '--media-state=state.json']), [
    '--input=export', '--media-state=state.json', '--validate', '--strict',
  ]);
});

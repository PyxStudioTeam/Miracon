import assert from 'node:assert/strict';
import test from 'node:test';
import { reverseObjectKeys, sourceRows } from './fixtures.mjs';
import {
  CONTRACT_VERSION,
  OMITTED_OBJECTS,
  buildSnapshot,
  buildTransferManifest,
  canonicalJson,
} from '../scripts/migration/transfer-contract.mjs';
import { transformSupabaseSnapshot } from '../scripts/migration/transform-supabase.mjs';

test('builds a versioned snapshot with deterministic identity and non-deterministic export metadata outside content', () => {
  const content = transformSupabaseSnapshot(sourceRows);
  const first = buildSnapshot({ content, exportedAt: '2026-08-12T10:00:00.000Z' });
  const second = buildSnapshot({ content: reverseObjectKeys(content), exportedAt: '2026-08-13T10:00:00.000Z' });
  assert.equal(first.version, CONTRACT_VERSION);
  assert.equal(first.snapshotId, second.snapshotId);
  assert.equal(first.contentHash, second.contentHash);
  assert.equal(canonicalJson(first.content), canonicalJson(second.content));
  assert.notEqual(first.exportedAt, second.exportedAt);
  assert.deepEqual(first.content.omittedObjects, OMITTED_OBJECTS);
  assert.deepEqual(first.content.urlRewriteMap, {});
});

test('normalizes source row order while preserving semantic playlist order', () => {
  const duplicateProject = { ...sourceRows.projects[0], id: 'project-2', slug: 'second-home', sort_order: 1, hero_videos: [
    { id: 'hero-b', desktopUrl: '/img/b.mp4', mobileUrl: null, posterUrl: null },
    { id: 'hero-a', desktopUrl: '/img/a.mp4', mobileUrl: null, posterUrl: null },
  ] };
  const forward = transformSupabaseSnapshot({ ...sourceRows, projects: [sourceRows.projects[0], duplicateProject] });
  const reverse = transformSupabaseSnapshot({ ...sourceRows, projects: [duplicateProject, sourceRows.projects[0]] });
  assert.equal(canonicalJson(forward), canonicalJson(reverse));
  assert.deepEqual(forward.projects[0].hero_videos.map((video) => video.id), ['hero-b', 'hero-a']);
});

test('rejects non-JSON values and duplicate stable IDs', () => {
  assert.throws(() => canonicalJson({ invalid: undefined }), /JSON/i);
  assert.throws(() => canonicalJson({ invalid: Number.NaN }), /JSON/i);
  assert.throws(() => transformSupabaseSnapshot({ ...sourceRows, projects: [...sourceRows.projects, sourceRows.projects[0]] }), /duplicate.*project/i);
  const duplicatePlaylist = { ...sourceRows.projects[0], hero_videos: [sourceRows.projects[0].hero_videos[0], sourceRows.projects[0].hero_videos[0]] };
  assert.throws(() => transformSupabaseSnapshot({ ...sourceRows, projects: [duplicatePlaylist] }), /duplicate stable id/i);
});

test('creates a validated manifest from migration file checksum input', () => {
  const snapshot = buildSnapshot({ content: transformSupabaseSnapshot(sourceRows), exportedAt: '2026-08-12T10:00:00.000Z' });
  const manifest = buildTransferManifest({
    snapshot,
    createdAt: '2026-08-12T10:01:00.000Z',
    files: [{ filename: 'snapshot.json', sha256: 'c'.repeat(64), bytes: 1234 }],
  });
  assert.equal(manifest.snapshotId, snapshot.snapshotId);
  assert.equal(manifest.files[0].bytes, 1234);
});

test('serialized output contains no secret-bearing input fields', () => {
  const content = transformSupabaseSnapshot({
    ...sourceRows,
    serviceRoleKey: 'fake-service-role-secret',
    authorization: 'Bearer fake-token',
    databaseUrl: 'postgresql://fake:fake@example.test/db',
  });
  const serialized = canonicalJson(buildSnapshot({ content, exportedAt: '2026-08-12T10:00:00.000Z' }));
  assert.doesNotMatch(serialized, /fake-service-role-secret|Bearer fake-token|postgresql:\/\//);
});

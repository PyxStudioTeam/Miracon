import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deriveMediaTarget, validateStorageLocation } from '../scripts/migration/media-paths.mjs';

test('derives deterministic readable targets from validated MIME instead of source extension', async () => {
  // Given
  const root = await mkdtemp(join(tmpdir(), 'miracon-media-paths-'));
  const hash = 'a'.repeat(64);

  // When
  const target = deriveMediaTarget({ mediaRoot: root, bucket: 'project-media', objectPath: 'Homes/My Villa.EXE', sha256: hash, mimeType: 'image/webp' });

  // Then
  const locationHash = createHash('sha256').update('project-media/Homes/My Villa.EXE').digest('hex');
  assert.equal(target.relativePath, `imports/project-media/${hash}-${locationHash}-my-villa.webp`);
  assert.equal(target.relativeUrl, `/media/imports/project-media/${hash}-${locationHash}-my-villa.webp`);
  assert.equal(target.absolutePath, join(root, 'imports', 'project-media', `${hash}-${locationHash}-my-villa.webp`));
});

test('derives distinct targets for distinct object keys with identical content and basenames', async () => {
  // Given
  const root = await mkdtemp(join(tmpdir(), 'miracon-media-paths-'));
  const common = { mediaRoot: root, bucket: 'project-media', sha256: 'b'.repeat(64), mimeType: 'image/webp' };

  // When
  const first = deriveMediaTarget({ ...common, objectPath: 'first/hero.jpg' });
  const second = deriveMediaTarget({ ...common, objectPath: 'second/hero.jpg' });

  // Then
  assert.notEqual(first.relativePath, second.relativePath);
  assert.match(first.relativePath, /-hero\.webp$/u);
  assert.match(second.relativePath, /-hero\.webp$/u);
});

test('rejects absolute, backslash, empty, traversal, and encoded traversal storage locations', () => {
  // Given
  const invalid = [
    ['', 'file.webp'], ['bucket', ''], ['/bucket', 'file.webp'], ['bucket', '/file.webp'],
    ['bucket', '../file.webp'], ['bucket', 'folder\\file.webp'], ['bucket', 'folder/%2e%2e/file.webp'],
    ['bucket', 'folder/%252e%252e/file.webp'], ['bucket/child', 'file.webp'],
  ];

  // When / Then
  for (const [bucket, objectPath] of invalid) {
    assert.throws(() => validateStorageLocation(bucket, objectPath), /storage|path|bucket|traversal/i);
  }
});

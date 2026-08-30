import { stat } from 'node:fs/promises';
import { assertNoSymlinks, hashFileNoFollow, resolveMediaPath } from './media-filesystem.mjs';

const STATE_VERSION = 'miracon-media-transfer/v1';
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function assertStateIdentity(mediaState) {
  if (mediaState?.version !== STATE_VERSION || !SHA256_PATTERN.test(mediaState.contentHash) || mediaState.snapshotId !== `snapshot-${mediaState.contentHash}`) {
    throw new TypeError('Media state snapshot/content identity mismatch');
  }
  if (!Array.isArray(mediaState.records)) throw new TypeError('Media state records are required');
}

export async function verifyMediaState({ mediaRoot, mediaState }) {
  assertStateIdentity(mediaState);
  await assertNoSymlinks(mediaRoot);
  const rootDetails = await stat(mediaRoot);
  if (!rootDetails.isDirectory()) throw new TypeError('Media root must be an existing directory');
  const keys = new Set();
  const relativePaths = new Set();
  let totalBytes = 0;
  for (const [index, record] of mediaState.records.entries()) {
    if (record?.status !== 'completed') throw new TypeError(`Media state record ${index} must be completed`);
    if (typeof record.key !== 'string' || record.key === '' || keys.has(record.key)) throw new TypeError('Media state record keys must be unique');
    if (relativePaths.has(record.relativePath)) throw new TypeError(`Duplicate media relative path: ${record.relativePath}`);
    if (!Number.isSafeInteger(record.bytes) || record.bytes <= 0 || !SHA256_PATTERN.test(record.sha256)) throw new TypeError('Completed media metadata is invalid');
    const absolutePath = resolveMediaPath(mediaRoot, record.relativePath);
    keys.add(record.key);
    relativePaths.add(record.relativePath);
    await assertNoSymlinks(absolutePath);
    const actual = await hashFileNoFollow(absolutePath);
    if (actual.bytes !== record.bytes || actual.sha256 !== record.sha256) throw new TypeError(`Media checksum or byte count mismatch for ${record.relativePath}`);
    totalBytes += actual.bytes;
  }
  return { snapshotId: mediaState.snapshotId, contentHash: mediaState.contentHash, files: mediaState.records.length, bytes: totalBytes };
}

import { basename } from 'node:path';
import { CONTRACT_VERSION, canonicalJson, sha256 } from './transfer-contract.mjs';
import { validateStorageLocation } from './media-paths.mjs';

const MEDIA_STATE_VERSION = 'miracon-media-transfer/v1';
const COUNT_KEYS = ['projects', 'projectImages', 'homepageVideos', 'mediaReferences'];

export class PostgresImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PostgresImportError';
  }
}

function assertSnapshot(snapshot) {
  if (snapshot?.version !== CONTRACT_VERSION || !snapshot.content || typeof snapshot.content !== 'object') {
    throw new PostgresImportError('Unsupported snapshot contract version');
  }
  const contentHash = sha256(snapshot.content);
  if (snapshot.contentHash !== contentHash || snapshot.snapshotId !== `snapshot-${contentHash}`) {
    throw new PostgresImportError('Snapshot content identity does not match its hashes');
  }
  for (const key of COUNT_KEYS) {
    if (!Array.isArray(snapshot.content[key]) || snapshot.content.counts?.[key] !== snapshot.content[key].length) {
      throw new PostgresImportError(`Snapshot count mismatch for ${key}`);
    }
  }
  const candidates = snapshot.content.mediaReferences.filter((item) => item.transferCandidate === true && item.classification === 'supabase-storage');
  if (snapshot.content.counts?.siteSettings !== 1 || snapshot.content.siteSettings?.id !== 1 || snapshot.content.counts?.transferCandidates !== candidates.length) {
    throw new PostgresImportError('Snapshot singleton or transfer candidate count mismatch');
  }
  return candidates;
}

function assertMigrations(expected, actual) {
  const normalize = (items) => canonicalJson([...items].sort((left, right) => left.filename.localeCompare(right.filename)));
  if (!Array.isArray(actual) || normalize(expected) !== normalize(actual)) {
    throw new PostgresImportError('Target migration filename/checksum set does not match snapshot');
  }
}

function completedMedia(snapshot, mediaState, candidates) {
  if (mediaState?.version !== MEDIA_STATE_VERSION || mediaState.snapshotId !== snapshot.snapshotId || mediaState.contentHash !== snapshot.contentHash) {
    throw new PostgresImportError('Media state snapshot/content identity mismatch');
  }
  if (!Array.isArray(mediaState.records)) throw new PostgresImportError('Media state records are required');
  const records = new Map(mediaState.records.map((record) => [record.key, record]));
  for (const candidate of candidates) {
    const location = validateStorageLocation(candidate.bucket, candidate.objectPath);
    const record = records.get(`${location.bucket}/${location.objectPath}`);
    if (record?.status !== 'completed') throw new PostgresImportError(`Completed media record is required for ${location.bucket}/${location.objectPath}`);
    if (!record.references?.includes(candidate.originalUrl)) throw new PostgresImportError('Completed media record does not include every original URL');
  }
  const usedKeys = new Set(candidates.map((item) => `${item.bucket}/${item.objectPath}`));
  return [...records.values()].filter((record) => usedKeys.has(record.key)).map((record) => {
    if (!/^\/media\//u.test(record.relativeUrl) || /^[a-z][a-z0-9+.-]*:/iu.test(record.relativeUrl) || record.relativePath?.startsWith('/')) {
      throw new PostgresImportError('Completed media targets must use relative /media URLs and relative paths');
    }
    if (!Number.isSafeInteger(record.bytes) || record.bytes <= 0 || !/^[a-f0-9]{64}$/u.test(record.sha256) || typeof record.mimeType !== 'string') {
      throw new PostgresImportError('Completed media metadata is invalid');
    }
    return record;
  });
}

function rewriteExact(value, rewrites) {
  if (typeof value === 'string') return rewrites.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => rewriteExact(item, rewrites));
  if (value && typeof value === 'object') {
    const keys = new Set();
    const entries = Object.entries(value).map(([key, item]) => {
      const rewrittenKey = rewrites.get(key) ?? key;
      if (keys.has(rewrittenKey)) throw new PostgresImportError(`URL rewrite key collision for ${rewrittenKey}`);
      keys.add(rewrittenKey);
      return [rewrittenKey, rewriteExact(item, rewrites)];
    });
    return Object.fromEntries(entries);
  }
  return value;
}

function stableMediaId(record) {
  return `migration-${sha256(`${record.bucket}/${record.objectPath}`).slice(0, 40)}`;
}

export function prepareImport({ snapshot, mediaState, targetMigrations }) {
  const candidates = assertSnapshot(snapshot);
  assertMigrations(snapshot.content.targetMigrations, targetMigrations);
  const records = completedMedia(snapshot, mediaState, candidates);
  const rewrites = new Map(records.flatMap((record) => record.references.map((url) => [url, record.relativeUrl])));
  for (const candidate of candidates) {
    const rewritten = rewrites.get(candidate.originalUrl);
    if (!rewritten || !rewritten.startsWith('/media/')) throw new PostgresImportError('Every transfer candidate requires a relative URL rewrite');
  }
  const content = rewriteExact(snapshot.content, rewrites);
  const pathsByUrl = new Map(records.flatMap((record) => record.references.map((url) => [url, record.relativePath])));
  content.projectImages.forEach((image, index) => { image.storage_path = pathsByUrl.get(snapshot.content.projectImages[index].url) ?? image.storage_path; });
  content.homepageVideos.forEach((video, index) => {
    video.desktop_storage_path = pathsByUrl.get(snapshot.content.homepageVideos[index].desktop_url) ?? video.desktop_storage_path;
    video.mobile_storage_path = pathsByUrl.get(snapshot.content.homepageVideos[index].mobile_url) ?? video.mobile_storage_path;
  });
  return {
    snapshotId: snapshot.snapshotId, contentHash: snapshot.contentHash,
    targetMigrations: snapshot.content.targetMigrations,
    projects: content.projects, projectImages: content.projectImages,
    homepageVideos: content.homepageVideos, siteSettings: content.siteSettings,
    mediaFiles: records.map((record) => ({
      id: stableMediaId(record), relative_url: record.relativeUrl, relative_path: record.relativePath,
      original_name: basename(record.objectPath), mime_type: record.mimeType, size_bytes: record.bytes,
      sha256: record.sha256, uploaded_by: null,
      metadata: { migration: { snapshotId: snapshot.snapshotId, contentHash: snapshot.contentHash, bucket: record.bucket, objectPath: record.objectPath, key: record.key } },
    })),
    counts: { projects: content.projects.length, projectImages: content.projectImages.length, homepageVideos: content.homepageVideos.length, siteSettings: 1, mediaFiles: records.length },
  };
}

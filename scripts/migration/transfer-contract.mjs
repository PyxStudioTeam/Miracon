import { createHash } from 'node:crypto';

export const CONTRACT_VERSION = 'miracon-phase4-transfer/v1';
export const OMITTED_OBJECTS = Object.freeze([
  { domain: 'supabase-auth', objects: ['auth.users'], reason: 'Target authentication is provisioned independently.' },
  { domain: 'admin-allowlist', objects: ['public.admin_users'], reason: 'Target administrator identity is provisioned independently.' },
  { domain: 'row-security', objects: ['RLS policies', 'grants', 'public.is_admin'], reason: 'Target authorization is application-owned.' },
  { domain: 'media-worker', objects: ['media_assets', 'media_variants', 'media_processing_jobs'], reason: 'Async media processing is excluded from first cutover.' },
  { domain: 'worker-state', objects: ['queue leases', 'retry state', 'cleanup tombstones'], reason: 'Ephemeral worker state is not content.' },
  { domain: 'unreferenced-storage', objects: ['storage.objects not referenced by persisted content'], reason: 'Only content-referenced storage objects are transfer candidates.' },
]);

export class TransferContractError extends TypeError {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = 'TransferContractError';
    this.path = path;
  }
}

function normalizeJson(value, path, ancestors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TransferContractError(path, 'number is not valid JSON');
    return value;
  }
  if (typeof value !== 'object') throw new TransferContractError(path, 'value is not valid JSON');
  if (ancestors.has(value)) throw new TransferContractError(path, 'cyclic values are not valid JSON');
  const nextAncestors = new Set(ancestors).add(value);
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeJson(item, `${path}[${index}]`, nextAncestors));
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TransferContractError(path, 'only plain JSON objects are accepted');
  }
  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    normalized[key] = normalizeJson(value[key], `${path}.${key}`, nextAncestors);
  }
  return normalized;
}

export function canonicalJson(value) {
  return JSON.stringify(normalizeJson(value, '$', new Set()));
}

export function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value), 'utf8').digest('hex');
}

function requiredString(value, path) {
  if (typeof value !== 'string' || value.trim() === '') throw new TransferContractError(path, 'non-empty string is required');
  return value;
}

function timestamp(value, path) {
  const parsed = requiredString(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(parsed) || Number.isNaN(Date.parse(parsed))) {
    throw new TransferContractError(path, 'UTC ISO timestamp is required');
  }
  return parsed;
}

function assertUniqueIds(items, path) {
  if (!Array.isArray(items)) throw new TransferContractError(path, 'array is required');
  const ids = new Set();
  for (const [index, item] of items.entries()) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new TransferContractError(`${path}[${index}]`, 'object is required');
    const id = requiredString(item.id, `${path}[${index}].id`);
    if (ids.has(id)) throw new TransferContractError(path, `duplicate stable id ${id}`);
    ids.add(id);
  }
}

function validateContent(content) {
  canonicalJson(content);
  requiredString(content.sourceIdentifier, '$.content.sourceIdentifier');
  assertUniqueIds(content.projects, '$.content.projects');
  assertUniqueIds(content.projectImages, '$.content.projectImages');
  assertUniqueIds(content.homepageVideos, '$.content.homepageVideos');
  if (!Array.isArray(content.mediaReferences)) throw new TransferContractError('$.content.mediaReferences', 'array is required');
  if (!Array.isArray(content.targetMigrations)) throw new TransferContractError('$.content.targetMigrations', 'array is required');
  for (const [index, migration] of content.targetMigrations.entries()) {
    requiredString(migration.filename, `$.content.targetMigrations[${index}].filename`);
    if (typeof migration.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(migration.sha256)) {
      throw new TransferContractError(`$.content.targetMigrations[${index}].sha256`, 'lowercase SHA-256 is required');
    }
  }
}

export function buildSnapshot({ content, exportedAt }) {
  validateContent(content);
  const contentHash = sha256(content);
  return {
    version: CONTRACT_VERSION,
    snapshotId: `snapshot-${contentHash}`,
    contentHash,
    exportedAt: timestamp(exportedAt, '$.exportedAt'),
    content: normalizeJson(content, '$.content', new Set()),
  };
}

export function buildTransferManifest({ snapshot, createdAt, files }) {
  if (snapshot?.version !== CONTRACT_VERSION) throw new TransferContractError('$.snapshot.version', 'unsupported contract version');
  requiredString(snapshot.snapshotId, '$.snapshot.snapshotId');
  if (!Array.isArray(files)) throw new TransferContractError('$.files', 'array is required');
  const parsedFiles = files.map((file, index) => {
    const filename = requiredString(file?.filename, `$.files[${index}].filename`);
    if (filename.includes('\\') || filename.startsWith('/') || filename.split('/').includes('..')) {
      throw new TransferContractError(`$.files[${index}].filename`, 'relative traversal-free filename is required');
    }
    if (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new TransferContractError(`$.files[${index}].sha256`, 'lowercase SHA-256 is required');
    }
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) throw new TransferContractError(`$.files[${index}].bytes`, 'non-negative byte count is required');
    return { filename, sha256: file.sha256, bytes: file.bytes };
  });
  return {
    version: CONTRACT_VERSION,
    snapshotId: snapshot.snapshotId,
    contentHash: snapshot.contentHash,
    createdAt: timestamp(createdAt, '$.createdAt'),
    files: parsedFiles.sort((left, right) => left.filename.localeCompare(right.filename)),
  };
}

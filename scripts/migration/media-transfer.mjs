import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { canonicalJson } from './transfer-contract.mjs';
import { assertNoSymlinks, hashFileNoFollow as hashFile } from './media-filesystem.mjs';
import { deriveMediaTarget, mapOriginalUrl, validateStorageLocation } from './media-paths.mjs';
import { isSafeSvg } from '../../src/lib/server/media/svg-policy.mjs';

const STATE_VERSION = 'miracon-media-transfer/v1';
const SIGNATURE_BYTES = 32;
const REQUEST_MAX_BYTES = 51 * 1024 * 1024;
const MIME_CONTRACTS = Object.freeze({
  'image/jpeg': { maxBytes: 20 * 1024 * 1024, valid: (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  'image/png': { maxBytes: 20 * 1024 * 1024, valid: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { maxBytes: 20 * 1024 * 1024, valid: (bytes) => bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP' },
  'image/avif': { maxBytes: 20 * 1024 * 1024, valid: (bytes) => validFtyp(bytes, ['avif', 'avis']) },
  'image/svg+xml': { maxBytes: 20 * 1024 * 1024, valid: isSafeSvg },
  'video/mp4': { maxBytes: 50 * 1024 * 1024, valid: (bytes) => validFtyp(bytes, ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'dash']) },
  'application/pdf': { maxBytes: 25 * 1024 * 1024, valid: (bytes) => bytes.subarray(0, 5).toString('ascii') === '%PDF-' },
});

function validFtyp(bytes, brands) {
  if (bytes.length < 12 || bytes.subarray(4, 8).toString('ascii') !== 'ftyp') return false;
  const size = bytes.readUInt32BE(0);
  if (size < 16) return false;
  for (let offset = 8; offset + 4 <= Math.min(bytes.length, size); offset += 4) {
    if (brands.includes(bytes.subarray(offset, offset + 4).toString('ascii'))) return true;
  }
  return false;
}

function metadataFrom(value, path) {
  const metadata = {};
  if (value.bytes !== undefined) {
    if (!Number.isSafeInteger(value.bytes) || value.bytes <= 0) throw new TypeError(`${path}.bytes must be a positive safe integer`);
    metadata.bytes = value.bytes;
  }
  if (value.sha256 !== undefined) {
    if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new TypeError(`${path}.sha256 must be lowercase SHA-256`);
    metadata.sha256 = value.sha256;
  }
  if (value.mimeType !== undefined) {
    const mimeType = typeof value.mimeType === 'string' ? value.mimeType.toLowerCase() : '';
    if (!MIME_CONTRACTS[mimeType]) throw new TypeError(`${path}.mimeType is unsupported`);
    metadata.mimeType = mimeType;
  }
  return metadata;
}

function mergeMetadata(current, incoming, key) {
  for (const field of ['bytes', 'sha256', 'mimeType']) {
    if (current[field] !== undefined && incoming[field] !== undefined && current[field] !== incoming[field]) throw new TypeError(`Conflicting ${field} metadata for ${key}`);
  }
  return { ...current, ...incoming };
}

function collectCandidates(snapshot) {
  if (snapshot?.version !== 'miracon-phase4-transfer/v1' || typeof snapshot.snapshotId !== 'string' || !Array.isArray(snapshot.content?.mediaReferences)) {
    throw new TypeError('A valid transfer snapshot is required');
  }
  const grouped = new Map();
  for (const [index, item] of snapshot.content.mediaReferences.entries()) {
    if (item?.classification !== 'supabase-storage' || item.transferCandidate !== true) continue;
    const location = validateStorageLocation(item.bucket, item.objectPath);
    if (typeof item.originalUrl !== 'string') throw new TypeError(`mediaReferences[${index}].originalUrl is required`);
    new URL(item.originalUrl);
    const key = `${location.bucket}/${location.objectPath}`;
    const metadata = metadataFrom(item, `mediaReferences[${index}]`);
    const existing = grouped.get(key);
    if (existing) {
      existing.metadata = mergeMetadata(existing.metadata, metadata, key);
      existing.references.push(item.originalUrl);
    } else {
      grouped.set(key, { key, ...location, metadata, references: [item.originalUrl] });
    }
  }
  return [...grouped.values()].map((candidate) => ({ ...candidate, references: [...new Set(candidate.references)].sort() })).sort((left, right) => left.key.localeCompare(right.key));
}

async function existingLstat(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeAll(handle, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const written = await handle.write(buffer, offset);
    offset += written.bytesWritten;
  }
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await assertNoSymlinks(path);
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile(`${canonicalJson(value)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function readState(path, snapshot, resume) {
  if (!resume) return null;
  try {
    const state = JSON.parse(await readFile(path, 'utf8'));
    if (state.version !== STATE_VERSION || state.snapshotId !== snapshot.snapshotId || !Array.isArray(state.records)) throw new TypeError('Transfer state does not match snapshot');
    return state;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function streamVerified(result, temporaryPath, expected) {
  const mimeType = typeof result?.mimeType === 'string' ? result.mimeType.toLowerCase() : '';
  const contract = MIME_CONTRACTS[mimeType];
  if (!contract || !result.stream || typeof result.stream[Symbol.asyncIterator] !== 'function') throw new TypeError('Downloader must return a stream and supported MIME type');
  const declared = metadataFrom({ bytes: result.bytes, sha256: result.sha256, mimeType }, 'downloader');
  const authoritative = mergeMetadata(expected, declared, 'download');
  const handle = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    const hash = createHash('sha256');
    const signature = [];
    const signatureLimit = mimeType === 'image/svg+xml' ? contract.maxBytes : SIGNATURE_BYTES;
    let signatureLength = 0;
    let bytes = 0;
    for await (const chunk of result.stream) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > REQUEST_MAX_BYTES || bytes > contract.maxBytes) throw new TypeError('Downloaded media exceeds size limit');
      if (signatureLength < signatureLimit) {
        const prefix = buffer.subarray(0, signatureLimit - signatureLength);
        signature.push(prefix); signatureLength += prefix.length;
      }
      hash.update(buffer);
      await writeAll(handle, buffer);
    }
    const sha256 = hash.digest('hex');
    if (bytes === 0 || !contract.valid(Buffer.concat(signature))) throw new TypeError('Downloaded media signature does not match MIME type');
    if (authoritative.bytes !== undefined && authoritative.bytes !== bytes) throw new TypeError('Downloader declared size mismatch');
    if (authoritative.sha256 !== undefined && authoritative.sha256 !== sha256) throw new TypeError('Downloader declared checksum mismatch');
    await handle.sync();
    return { bytes, sha256, mimeType };
  } finally {
    await handle.close();
  }
}

async function assertSafeExistingSvg(path, mimeType) {
  if (mimeType === 'image/svg+xml' && !isSafeSvg(await readFile(path))) {
    throw new TypeError('Existing SVG content is unsafe');
  }
}

function stateView(snapshot, candidates, records) {
  return { version: STATE_VERSION, snapshotId: snapshot.snapshotId, contentHash: snapshot.contentHash, records: candidates.map((candidate) => records.get(candidate.key) ?? { key: candidate.key, bucket: candidate.bucket, objectPath: candidate.objectPath, references: candidate.references, status: 'pending' }) };
}

export async function transferSnapshotMedia({ snapshot, mediaRoot, statePath, downloader, dryRun = false, resume = false }) {
  if (!isAbsolute(mediaRoot) || !isAbsolute(statePath)) throw new TypeError('Media root and state path must be absolute');
  await assertNoSymlinks(mediaRoot);
  const rootDetails = await stat(mediaRoot);
  if (!rootDetails.isDirectory()) throw new TypeError('Media root must be an existing directory');
  const candidates = collectCandidates(snapshot);
  if (dryRun) return { candidates: candidates.map((candidate) => ({ ...candidate, status: 'pending' })), urlRewriteMap: {} };
  if (typeof downloader !== 'function') throw new TypeError('Injected downloader function is required');
  const previous = await readState(statePath, snapshot, resume);
  const records = new Map((previous?.records ?? []).map((record) => [record.key, record]));
  await atomicJson(statePath, stateView(snapshot, candidates, records));
  for (const candidate of candidates) {
    const prior = records.get(candidate.key);
    if (prior?.status === 'completed') {
      const target = deriveMediaTarget({ mediaRoot, ...candidate, sha256: prior.sha256, mimeType: prior.mimeType });
      await assertNoSymlinks(target.absolutePath);
      const actual = await hashFile(target.absolutePath);
      if (actual.bytes !== prior.bytes || actual.sha256 !== prior.sha256) throw new TypeError(`Existing target mismatch for ${candidate.key}`);
      await assertSafeExistingSvg(target.absolutePath, prior.mimeType);
      records.set(candidate.key, { ...prior, ...target, references: candidate.references });
      continue;
    }
    if (candidate.metadata.bytes !== undefined && candidate.metadata.sha256 !== undefined && candidate.metadata.mimeType !== undefined) {
      const target = deriveMediaTarget({ mediaRoot, ...candidate, sha256: candidate.metadata.sha256, mimeType: candidate.metadata.mimeType });
      await assertNoSymlinks(target.absolutePath);
      const existing = await existingLstat(target.absolutePath);
      if (existing) {
        if (!existing.isFile()) throw new TypeError(`Unsafe existing target for ${candidate.key}`);
        const actual = await hashFile(target.absolutePath);
        if (actual.bytes !== candidate.metadata.bytes || actual.sha256 !== candidate.metadata.sha256) throw new TypeError(`Existing target mismatch for ${candidate.key}`);
        await assertSafeExistingSvg(target.absolutePath, candidate.metadata.mimeType);
        records.set(candidate.key, { key: candidate.key, bucket: candidate.bucket, objectPath: candidate.objectPath, references: candidate.references, status: 'completed', ...candidate.metadata, ...target });
        await atomicJson(statePath, stateView(snapshot, candidates, records));
        continue;
      }
    }
    const temporaryDirectory = resolve(mediaRoot, '.tmp');
    await mkdir(temporaryDirectory, { recursive: true });
    await assertNoSymlinks(temporaryDirectory);
    const temporaryPath = resolve(temporaryDirectory, `${randomUUID()}.part`);
    try {
      const verified = await streamVerified(await downloader({ bucket: candidate.bucket, objectPath: candidate.objectPath, originalUrls: candidate.references }), temporaryPath, candidate.metadata);
      const target = deriveMediaTarget({ mediaRoot, ...candidate, ...verified });
      await mkdir(dirname(target.absolutePath), { recursive: true });
      await assertNoSymlinks(dirname(target.absolutePath));
      const existing = await existingLstat(target.absolutePath);
      if (existing) {
        if (existing.isSymbolicLink() || !existing.isFile()) throw new TypeError(`Unsafe existing target for ${candidate.key}`);
        const actual = await hashFile(target.absolutePath);
        if (actual.bytes !== verified.bytes || actual.sha256 !== verified.sha256) throw new TypeError(`Existing target mismatch for ${candidate.key}`);
        await assertSafeExistingSvg(target.absolutePath, verified.mimeType);
      } else {
        await rename(temporaryPath, target.absolutePath);
      }
      records.set(candidate.key, { key: candidate.key, bucket: candidate.bucket, objectPath: candidate.objectPath, references: candidate.references, status: 'completed', ...verified, ...target });
      await atomicJson(statePath, stateView(snapshot, candidates, records));
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
  const completed = candidates.map((candidate) => records.get(candidate.key));
  const urlRewriteMap = Object.fromEntries(completed.flatMap((record) => record.references.map((originalUrl) => [originalUrl, mapOriginalUrl(originalUrl, record.relativeUrl)])).sort(([left], [right]) => left.localeCompare(right)));
  return { candidates: completed, urlRewriteMap };
}

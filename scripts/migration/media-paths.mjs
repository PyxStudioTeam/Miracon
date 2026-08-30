import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const MIME_EXTENSIONS = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'application/pdf': 'pdf',
});

function decodeFully(value) {
  let decoded = value;
  for (let count = 0; count < 4; count += 1) {
    let next;
    try {
      next = decodeURIComponent(decoded);
    } catch (error) {
      if (error instanceof URIError) throw new TypeError('Storage path has invalid encoding');
      throw error;
    }
    if (next === decoded) return decoded;
    decoded = next;
  }
  return decoded;
}

function validatePart(value, label, allowSlash) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`Storage ${label} is required`);
  if (value.includes('\\') || isAbsolute(value) || value.startsWith('/')) throw new TypeError(`Storage ${label} must be a relative forward-slash path`);
  const decoded = decodeFully(value);
  if (decoded.includes('\\') || decoded.startsWith('/')) throw new TypeError(`Storage ${label} contains an unsafe path`);
  const segments = decoded.split('/');
  if ((!allowSlash && segments.length !== 1) || segments.some((part) => part === '' || part === '.' || part === '..')) {
    throw new TypeError(`Storage ${label} contains traversal or empty segments`);
  }
  return decoded;
}

export function validateStorageLocation(bucket, objectPath) {
  return {
    bucket: validatePart(bucket, 'bucket', false),
    objectPath: validatePart(objectPath, 'path', true),
  };
}

export function assertContained(mediaRoot, absolutePath) {
  if (!isAbsolute(mediaRoot)) throw new TypeError('Media root must be absolute');
  const root = resolve(mediaRoot);
  const target = resolve(absolutePath);
  const child = relative(root, target);
  if (child === '' || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new TypeError('Media target escapes configured root');
  return target;
}

function safeBasename(objectPath) {
  const source = objectPath.split('/').at(-1).replace(/\.[^.]*$/, '');
  const safe = source.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return (safe || 'media').slice(0, 80).replace(/-+$/g, '') || 'media';
}

export function deriveMediaTarget({ mediaRoot, bucket, objectPath, sha256, mimeType }) {
  const location = validateStorageLocation(bucket, objectPath);
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new TypeError('Lowercase SHA-256 is required');
  const extension = MIME_EXTENSIONS[mimeType?.toLowerCase()];
  if (!extension) throw new TypeError('Unsupported media MIME type');
  const locationHash = createHash('sha256').update(`${location.bucket}/${location.objectPath}`).digest('hex');
  const filename = `${sha256}-${locationHash}-${safeBasename(location.objectPath)}.${extension}`;
  const relativePath = `imports/${location.bucket}/${filename}`;
  return {
    relativePath,
    relativeUrl: `/media/${relativePath}`,
    absolutePath: assertContained(mediaRoot, join(mediaRoot, ...relativePath.split('/'))),
  };
}

export function mapOriginalUrl(originalUrl, relativeUrl) {
  new URL(originalUrl);
  return relativeUrl;
}

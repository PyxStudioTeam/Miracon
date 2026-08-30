import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute, join, parse, resolve } from 'node:path';
import { assertContained } from './media-paths.mjs';

async function existingLstat(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function assertNoSymlinks(path) {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const parts = absolute.slice(root.length).split(/[\\/]/u).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = resolve(current, part);
    const details = await existingLstat(current);
    if (details?.isSymbolicLink()) throw new TypeError(`Symlinked path is not allowed: ${current}`);
  }
}

export async function hashFileNoFollow(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const details = await handle.stat();
    if (!details.isFile()) throw new TypeError('Media target must be a regular file');
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      hash.update(chunk);
    }
    return { bytes, sha256: hash.digest('hex') };
  } finally {
    await handle.close();
  }
}

export function resolveMediaPath(mediaRoot, relativePath) {
  if (!isAbsolute(mediaRoot)) throw new TypeError('Media root must be absolute');
  if (typeof relativePath !== 'string' || relativePath === '' || relativePath.includes('\\') || isAbsolute(relativePath) || relativePath.startsWith('/')) {
    throw new TypeError('Media relative path must be a relative forward-slash path');
  }
  let decoded = relativePath;
  for (let count = 0; count < 4; count += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch (error) {
      if (error instanceof URIError) throw new TypeError('Media relative path has invalid encoding');
      throw error;
    }
  }
  if (decoded.includes('\\') || decoded.startsWith('/')) throw new TypeError('Media relative path contains an unsafe path');
  const segments = decoded.split('/');
  if (segments.some((part) => part === '' || part === '.' || part === '..')) throw new TypeError('Media relative path contains traversal or empty segments');
  return assertContained(mediaRoot, join(mediaRoot, ...relativePath.split('/')));
}

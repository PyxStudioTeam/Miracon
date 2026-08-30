import { createReadStream } from 'node:fs';
import { lstat, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fail, succeed } from './types';
import type { ByteRange, MediaReadPlan, MediaResult, PrepareMediaReadInput } from './types';

export async function prepareMediaRead(input: PrepareMediaReadInput): Promise<MediaResult<MediaReadPlan>> {
  const resolved = await resolveMediaPath(input.root.path, input.relativePath);
  if (!resolved.ok) return resolved;

  const file = await stat(resolved.value);
  if (!file.isFile()) return fail('not_found', 'Media file was not found');
  const range = calculateByteRange(input.rangeHeader, file.size);
  if (!range.ok) return range;
  const contentLength = range.value ? range.value.end - range.value.start + 1 : file.size;
  const body = input.method === 'GET'
    ? createReadStream(resolved.value, range.value ? { start: range.value.start, end: range.value.end } : undefined)
    : null;
  return succeed({ status: range.value ? 206 : 200, contentLength, sizeBytes: file.size, range: range.value, body });
}

export function calculateByteRange(header: string | undefined, sizeBytes: number): MediaResult<ByteRange | null> {
  if (!header) return succeed(null);
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || sizeBytes < 1) return fail('range_not_satisfiable', 'Requested range is not satisfiable');
  const startText = match[1];
  const endText = match[2];
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength < 1) return fail('range_not_satisfiable', 'Requested range is not satisfiable');
    return succeed({ start: Math.max(0, sizeBytes - suffixLength), end: sizeBytes - 1 });
  }
  const start = Number(startText);
  const requestedEnd = endText ? Number(endText) : sizeBytes - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= sizeBytes || requestedEnd < start) {
    return fail('range_not_satisfiable', 'Requested range is not satisfiable');
  }
  return succeed({ start, end: Math.min(requestedEnd, sizeBytes - 1) });
}

async function resolveMediaPath(root: string, relativePath: string): Promise<MediaResult<string>> {
  if (!relativePath || isAbsolute(relativePath) || relativePath.includes('\\')) return fail('unsafe_path', 'Media path is outside MEDIA_ROOT');
  const segments = relativePath.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return fail('unsafe_path', 'Media path is outside MEDIA_ROOT');
  const candidate = resolve(root, relativePath);
  if (relative(root, candidate).startsWith(`..${sep}`) || relative(root, candidate) === '..') return fail('unsafe_path', 'Media path is outside MEDIA_ROOT');
  for (let index = 1; index <= segments.length; index += 1) {
    const part = join(root, ...segments.slice(0, index));
    try {
      if ((await lstat(part)).isSymbolicLink()) return fail('unsafe_path', 'Media path contains a symbolic link');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return fail('not_found', 'Media file was not found');
      return fail('io', 'Failed to inspect media file');
    }
  }
  try {
    const actual = await realpath(candidate);
    if (relative(root, actual).startsWith(`..${sep}`) || relative(root, actual) === '..') return fail('unsafe_path', 'Media path is outside MEDIA_ROOT');
    return succeed(actual);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return fail('not_found', 'Media file was not found');
    return fail('io', 'Failed to inspect media file');
  }
}

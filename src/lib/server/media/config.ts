import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail, succeed } from './types';
import type { MediaResult, MediaRoot } from './types';

export async function getMediaRoot(): Promise<MediaResult<MediaRoot>> {
  return createMediaRoot(process.env.MEDIA_ROOT);
}

const initializedRoots = new Map<string, Promise<MediaResult<MediaRoot>>>();

export async function createMediaRoot(value: string | undefined): Promise<MediaResult<MediaRoot>> {
  if (!value?.trim()) return fail('configuration', 'MEDIA_ROOT is required');
  if (!isAbsolute(value)) return fail('configuration', 'MEDIA_ROOT must be an absolute path');
  const cached = initializedRoots.get(value);
  if (cached) return cached;
  const initialized = initializeMediaRoot(value);
  initializedRoots.set(value, initialized);
  const result = await initialized;
  if (!result.ok) initializedRoots.delete(value);
  return result;
}

async function initializeMediaRoot(value: string): Promise<MediaResult<MediaRoot>> {
  try {
    await mkdir(value, { recursive: true });
    if ((await lstat(value)).isSymbolicLink()) return fail('configuration', 'MEDIA_ROOT must not be a symbolic link');
    const root = await realpath(value);
    const temporary = await initializeManagedDirectory(root, '.tmp');
    const uploads = await initializeManagedDirectory(root, 'uploads');
    if (!temporary || !uploads) return fail('configuration', 'MEDIA_ROOT managed directories must not be symbolic links');
    const probe = join(root, `.media-write-probe-${randomUUID()}`);
    const handle = await open(probe, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.sync();
    await handle.close();
    await rm(probe);
    return succeed({ path: root });
  } catch (error) {
    if (error instanceof Error) return fail('configuration', 'MEDIA_ROOT must be writable');
    return fail('configuration', 'MEDIA_ROOT must be writable');
  }
}

async function initializeManagedDirectory(root: string, name: '.tmp' | 'uploads'): Promise<boolean> {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  const entry = await lstat(directory);
  if (!entry.isDirectory() || entry.isSymbolicLink()) return false;
  const resolved = await realpath(directory);
  const pathFromRoot = relative(root, resolved);
  return pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot);
}

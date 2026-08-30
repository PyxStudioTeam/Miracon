import { lstat, realpath, unlink } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { assertNoSymlinks, resolveMediaPath } from './migration/media-filesystem.mjs';

export async function resolveCleanupRoot(mediaRoot, CleanupError) {
  if (!isAbsolute(mediaRoot)) throw new CleanupError('MEDIA_ROOT must be an absolute path');
  await assertNoSymlinks(mediaRoot);
  try {
    const details = await lstat(mediaRoot);
    if (!details.isDirectory()) throw new CleanupError('MEDIA_ROOT must be a directory');
    return await realpath(mediaRoot);
  } catch (error) {
    if (error instanceof CleanupError) throw error;
    throw new CleanupError('MEDIA_ROOT is unavailable', { cause: error });
  }
}

export async function removeCleanupCandidate(root, candidate, CleanupError) {
  let absolutePath;
  try {
    absolutePath = resolveMediaPath(root, candidate.relativePath);
    await assertNoSymlinks(absolutePath);
    const pathFromRoot = relative(root, absolutePath);
    if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
      throw new CleanupError(`Unsafe media path for ${candidate.id}`);
    }
    const details = await lstat(absolutePath);
    if (!details.isFile()) throw new CleanupError(`Media path is not a regular file for ${candidate.id}`);
    await unlink(absolutePath);
    return 'deleted';
  } catch (error) {
    if (error instanceof CleanupError) throw error;
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT' && absolutePath) return 'missing';
    throw new CleanupError(`Unsafe media path for ${candidate.id}`, { cause: error });
  }
}

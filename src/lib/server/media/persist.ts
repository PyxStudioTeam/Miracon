import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { MEDIA_SIGNATURE_BYTES, verifyMediaSignature } from './signature';
import { MEDIA_LIMITS, fail, succeed } from './types';
import type { MediaMimeContract, MediaResult, SaveMediaFileInput, SavedMediaFile } from './types';

const mimeContracts: Readonly<Record<string, MediaMimeContract>> = {
  'image/jpeg': { extension: 'jpg', maxBytes: MEDIA_LIMITS.image },
  'image/png': { extension: 'png', maxBytes: MEDIA_LIMITS.image },
  'image/webp': { extension: 'webp', maxBytes: MEDIA_LIMITS.image },
  'image/avif': { extension: 'avif', maxBytes: MEDIA_LIMITS.image },
  'image/svg+xml': { extension: 'svg', maxBytes: MEDIA_LIMITS.image },
  'video/mp4': { extension: 'mp4', maxBytes: MEDIA_LIMITS.video },
  'application/pdf': { extension: 'pdf', maxBytes: MEDIA_LIMITS.pdf },
};

export function mimeContractFor(mimeType: string): MediaResult<MediaMimeContract> {
  const contract = mimeContracts[mimeType.toLowerCase()];
  return contract ? succeed(contract) : fail('invalid_upload', 'Unsupported media MIME type');
}

export async function saveMediaFile(input: SaveMediaFileInput): Promise<MediaResult<SavedMediaFile>> {
  const contract = mimeContractFor(input.mimeType);
  if (!contract.ok) return contract;

  const id = randomUUID();
  const relativePath = `uploads/${id}/${id}.${contract.value.extension}`;
  const temporaryPath = join(input.root.path, '.tmp', `${id}.part`);
  const finalPath = join(input.root.path, relativePath);
  await mkdir(join(input.root.path, 'uploads', id), { recursive: true });

  const written = await writeTemporaryFile(input.source, temporaryPath, contract.value);
  if (!written.ok) {
    await removeFile(temporaryPath);
    await removeDirectory(join(input.root.path, 'uploads', id));
    return written;
  }
  const signature = verifyMediaSignature(input.mimeType.toLowerCase(), written.value.signature);
  if (!signature.ok) {
    await removeFile(temporaryPath);
    await removeDirectory(join(input.root.path, 'uploads', id));
    return signature;
  }

  try {
    await rename(temporaryPath, finalPath);
  } catch (error) {
    await removeFile(temporaryPath);
    await removeDirectory(join(input.root.path, 'uploads', id));
    if (error instanceof Error) return fail('io', 'Failed to publish media file');
    return fail('io', 'Failed to publish media file');
  }

  const record = {
    id,
    relativeUrl: `/media/${relativePath}`,
    relativePath,
    originalName: input.originalName?.trim() || null,
    mimeType: input.mimeType.toLowerCase(),
    sizeBytes: written.value.sizeBytes,
    sha256: written.value.sha256,
    metadata: input.metadata ?? {},
    uploadedBy: input.uploadedBy ?? null,
  };
  try {
    await input.repository.insert(record);
  } catch (error) {
    await removeFile(finalPath);
    await removeDirectory(join(input.root.path, 'uploads', id));
    if (error instanceof Error) return fail('metadata', 'Failed to store media metadata');
    return fail('metadata', 'Failed to store media metadata');
  }

  return succeed({
    id: record.id,
    relativeUrl: record.relativeUrl,
    relativePath: record.relativePath,
    originalName: record.originalName,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    sha256: record.sha256,
  });
}

async function writeTemporaryFile(source: SaveMediaFileInput['source'], temporaryPath: string, contract: MediaMimeContract): Promise<MediaResult<{ readonly sizeBytes: number; readonly sha256: Buffer; readonly signature: Buffer }>> {
  let handle;
  try {
    handle = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const hash = createHash('sha256');
    const signatureParts: Buffer[] = [];
    const signatureLimit = contract.extension === 'svg' ? contract.maxBytes : MEDIA_SIGNATURE_BYTES;
    let signatureLength = 0;
    let sizeBytes = 0;
    for await (const chunk of source) {
      const bytes = Buffer.from(chunk);
      sizeBytes += bytes.length;
      if (sizeBytes > contract.maxBytes) return fail('invalid_upload', 'Media file exceeds its size limit');
      if (signatureLength < signatureLimit) {
        const prefix = bytes.subarray(0, signatureLimit - signatureLength);
        signatureParts.push(prefix);
        signatureLength += prefix.length;
      }
      hash.update(bytes);
      await writeAll(handle, bytes);
    }
    if (sizeBytes === 0) return fail('invalid_upload', 'Media file must not be empty');
    await handle.sync();
    return succeed({ sizeBytes, sha256: hash.digest(), signature: Buffer.concat(signatureParts) });
  } catch (error) {
    if (error instanceof Error) return fail('io', 'Failed to write media file');
    return fail('io', 'Failed to write media file');
  } finally {
    if (handle) await handle.close();
  }
}

async function writeAll(handle: Awaited<ReturnType<typeof open>>, bytes: Buffer): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const write = await handle.write(bytes, offset);
    offset += write.bytesWritten;
  }
}

async function removeFile(path: string): Promise<void> {
  try {
    await rm(path);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }
}

async function removeDirectory(path: string): Promise<void> {
  try {
    await rmdir(path);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }
}

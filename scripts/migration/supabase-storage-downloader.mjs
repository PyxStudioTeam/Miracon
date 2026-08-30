import { validateStorageLocation } from './media-paths.mjs';

export class SupabaseStorageDownloadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SupabaseStorageDownloadError';
  }
}

export function createSupabaseStorageDownloader(client) {
  return async ({ bucket, objectPath }) => {
    const location = validateStorageLocation(bucket, objectPath);
    let response;
    try {
      response = await client.storage.from(location.bucket).download(location.objectPath);
    } catch {
      throw new SupabaseStorageDownloadError('Supabase Storage download failed');
    }
    if (!response || typeof response !== 'object') {
      throw new SupabaseStorageDownloadError('Supabase Storage returned an invalid response');
    }
    if (response.error) throw new SupabaseStorageDownloadError('Supabase Storage download failed');
    const blob = response.data;
    if (!blob || typeof blob.type !== 'string' || typeof blob.size !== 'number' || typeof blob.stream !== 'function') {
      throw new SupabaseStorageDownloadError('Supabase Storage returned an invalid response');
    }
    const stream = blob.stream();
    if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
      throw new SupabaseStorageDownloadError('Supabase Storage returned an invalid response');
    }
    return {
      stream,
      mimeType: blob.type,
      ...(Number.isSafeInteger(blob.size) && blob.size > 0 ? { bytes: blob.size } : {}),
    };
  };
}

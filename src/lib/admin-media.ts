import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImageVariantSet } from './project-types';

const SOURCE_BUCKET = 'media-sources';
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const VIDEO_TYPES = new Set(['video/mp4']);
const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const IMAGE_MAX_PIXELS = 40_000_000;
const IMAGE_MAX_EDGE = 10_000;
const DIRECT_IMAGE_MAX_EDGE = 2400;
const DIRECT_IMAGE_QUALITY = 0.86;

export interface ProcessedMediaVariant {
  variantKey: string;
  bucketId: string;
  objectPath: string;
  url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  role: string;
  format: string;
}

export interface ProcessedMedia {
  assetId: string;
  jobId: string;
  primaryUrl: string;
  primaryPath: string;
  width: number | null;
  height: number | null;
  posterUrl: string | null;
  variants: ProcessedMediaVariant[];
}

interface ProcessMediaOptions {
  kind: 'image' | 'video';
  outputBucket: 'project-media' | 'site-media';
  profile: Record<string, unknown>;
  context: Record<string, unknown>;
  timeoutMs?: number;
}

interface JobResultRow {
  status?: string;
  result?: unknown;
  last_error?: string | null;
}

interface RegisterPublicMediaOptions {
  bucketId: 'project-media' | 'project-documents';
  objectPath: string;
  publicUrl: string;
  mimeType: 'image/svg+xml' | 'application/pdf';
  sizeBytes: number;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function safeFileName(name: string) {
  const sanitized = name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || 'media';
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseVariant(value: unknown): ProcessedMediaVariant | null {
  const row = object(value);
  const metadata = object(row.metadata);
  const url = String(row.url ?? '');
  const objectPath = String(row.object_path ?? row.storage_path ?? '');
  if (!url || !objectPath) return null;
  return {
    variantKey: String(row.variant_key ?? ''),
    bucketId: String(row.bucket_id ?? row.bucket ?? ''),
    objectPath,
    url,
    mimeType: String(row.mime_type ?? ''),
    width: numberOrNull(row.width),
    height: numberOrNull(row.height),
    sizeBytes: numberOrNull(row.size_bytes ?? row.bytes),
    role: String(metadata.role ?? row.role ?? ''),
    format: String(metadata.format ?? row.format ?? ''),
  };
}

async function imageDimensions(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

export async function readImageDimensions(file: File) {
  try {
    return await imageDimensions(file);
  } catch {
    return { width: 0, height: 0 };
  }
}

export async function optimizePhotoForDirectUpload(file: File): Promise<File> {
  await validateProcessableFile(file, 'image');
  if (file.type !== 'image/jpeg' && file.type !== 'image/png') return file;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, DIRECT_IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', DIRECT_IMAGE_QUALITY));
    if (!blob || (scale === 1 && blob.size >= file.size)) return file;
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
    return new File([blob], `${baseName}.webp`, { type: 'image/webp', lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}

export async function validateProcessableFile(file: File, kind: 'image' | 'video') {
  const allowedTypes = kind === 'image' ? IMAGE_TYPES : VIDEO_TYPES;
  if (!allowedTypes.has(file.type)) {
    throw new Error(kind === 'image' ? 'Use JPEG, PNG, WebP or AVIF images' : 'Only MP4 videos are supported');
  }

  const maxBytes = kind === 'image' ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES;
  if (file.size < 1 || file.size > maxBytes) {
    throw new Error(`${kind === 'image' ? 'Image' : 'Video'} must be smaller than ${maxBytes / 1024 / 1024} MB`);
  }

  if (kind === 'image') {
    let dimensions;
    try {
      dimensions = await imageDimensions(file);
    } catch {
      throw new Error('The image cannot be decoded');
    }
    if (dimensions.width > IMAGE_MAX_EDGE || dimensions.height > IMAGE_MAX_EDGE || dimensions.width * dimensions.height > IMAGE_MAX_PIXELS) {
      throw new Error('Image resolution must not exceed 10,000 px per side or 40 megapixels');
    }
  }
}

export async function processMediaUpload(
  supabase: SupabaseClient,
  file: File,
  options: ProcessMediaOptions,
): Promise<ProcessedMedia> {
  await validateProcessableFile(file, options.kind);
  const uploadId = crypto.randomUUID();
  const sourcePath = `incoming/${uploadId}/${safeFileName(file.name)}`;
  const { error: uploadError } = await supabase.storage.from(SOURCE_BUCKET).upload(sourcePath, file, {
    upsert: false,
    cacheControl: '3600',
    contentType: file.type,
  });
  if (uploadError) throw uploadError;

  let assetId = '';
  let jobId = '';
  const queueInput = {
    p_source_path: sourcePath,
    p_mime_type: file.type,
    p_source_size_bytes: file.size,
    p_requested_variants: [],
    p_metadata: {
      output_bucket: options.outputBucket,
      profile: options.profile,
      context: options.context,
      original_filename: file.name,
    },
    p_max_attempts: 3,
  };
  let queueError: unknown = null;
  let definitiveQueueFailure = false;
  for (let attempt = 0; attempt < 3 && !jobId; attempt += 1) {
    if (attempt > 0) await delay(500 * attempt);
    const { data, error } = await supabase.rpc('queue_media_processing', {
      ...queueInput,
    });
    if (error) {
      queueError = error;
      definitiveQueueFailure = ['22023', '42501'].includes(error.code ?? '');
      if (definitiveQueueFailure) break;
      continue;
    }
    const queued = Array.isArray(data) ? data[0] : data;
    assetId = String(queued?.asset_id ?? '');
    jobId = String(queued?.job_id ?? '');
    if (!assetId || !jobId) queueError = new Error('The media job was not created');
  }
  if (!assetId || !jobId) {
    if (definitiveQueueFailure) {
      const { error: rollbackError } = await supabase.storage.from(SOURCE_BUCKET).remove([sourcePath]);
      if (rollbackError) console.error('Unable to roll back media source upload:', rollbackError.message);
    }
    throw queueError instanceof Error ? queueError : new Error('Unable to confirm the media processing job. Retry this upload later.');
  }

  const timeoutMs = options.timeoutMs ?? (options.kind === 'video' ? 20 * 60_000 : 4 * 60_000);
  const deadline = Date.now() + timeoutMs;
  let row: JobResultRow | null = null;
  while (Date.now() < deadline) {
    const { data, error } = await supabase
      .from('media_processing_jobs')
      .select('status,result,last_error')
      .eq('id', jobId)
      .maybeSingle();
    if (error) throw error;
    row = data as JobResultRow | null;
    if (row?.status === 'completed') break;
    if (row?.status === 'failed') throw new Error(row.last_error || 'Media processing failed');
    await delay(1500);
  }
  if (row?.status !== 'completed') throw new Error('Media processing is taking too long. The job will continue in the background.');

  const result = object(row.result);
  const variants = (Array.isArray(result.variants) ? result.variants : []).map(parseVariant).filter((item): item is ProcessedMediaVariant => Boolean(item));
  const primaryUrl = String(result.primary_url ?? '');
  const primary = variants.find((variant) => variant.url === primaryUrl) ?? variants[0];
  if (!primaryUrl || !primary) throw new Error('Media processing completed without a public output');
  const poster = variants.find((variant) => variant.role === 'poster');

  return {
    assetId,
    jobId,
    primaryUrl,
    primaryPath: primary.objectPath,
    width: primary.width,
    height: primary.height,
    posterUrl: poster?.url ?? null,
    variants,
  };
}

export async function registerPublicMediaAsset(
  supabase: SupabaseClient,
  options: RegisterPublicMediaOptions,
) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await delay(500 * attempt);
    const { data, error } = await supabase.rpc('register_public_media_asset', {
      p_bucket_id: options.bucketId,
      p_object_path: options.objectPath,
      p_url: options.publicUrl,
      p_mime_type: options.mimeType,
      p_size_bytes: options.sizeBytes,
    });
    const registered = Array.isArray(data) ? data[0] : data;
    if (!error && registered?.asset_id) return String(registered.asset_id);
    lastError = error ?? new Error('The uploaded asset was not registered');
    if (error && ['22023', '42501'].includes(error.code ?? '')) break;
  }
  throw lastError instanceof Error ? lastError : new Error('Unable to register the uploaded asset');
}

export function toImageVariantSet(media: ProcessedMedia): ImageVariantSet {
  const candidates = (format: 'avif' | 'webp') => media.variants
    .filter((variant) => variant.format === format && variant.width)
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
    .map((variant) => ({ src: variant.url, width: variant.width!, ...(variant.height ? { height: variant.height } : {}) }));
  const avif = candidates('avif');
  const webp = candidates('webp');
  return {
    ...(media.width ? { width: media.width } : {}),
    ...(media.height ? { height: media.height } : {}),
    ...(avif.length ? { avif } : {}),
    ...(webp.length ? { webp } : {}),
  };
}

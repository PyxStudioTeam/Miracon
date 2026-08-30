import type { ReadStream } from 'node:fs';
import type { Readable } from 'node:stream';

export const MEDIA_LIMITS = {
  image: 20 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  pdf: 25 * 1024 * 1024,
} as const;

export const MEDIA_UPLOAD_REQUEST_MAX_BYTES = MEDIA_LIMITS.video + 1024 * 1024;

export type MediaError = {
  readonly kind: 'configuration' | 'invalid_upload' | 'io' | 'metadata' | 'not_found' | 'unsafe_path' | 'range_not_satisfiable';
  readonly message: string;
};

export type MediaResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: MediaError };

export type MediaRoot = { readonly path: string };

export type MediaMimeContract = {
  readonly extension: 'jpg' | 'png' | 'webp' | 'avif' | 'svg' | 'mp4' | 'pdf';
  readonly maxBytes: number;
};

export type MediaFileRecord = {
  readonly id: string;
  readonly relativeUrl: string;
  readonly relativePath: string;
  readonly originalName: string | null;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: Buffer;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
  readonly uploadedBy: number | null;
};

export interface MediaFileRepository {
  insert(record: MediaFileRecord): Promise<void>;
}

export type SaveMediaFileInput = {
  readonly root: MediaRoot;
  readonly source: Readable;
  readonly mimeType: string;
  readonly originalName?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
  readonly uploadedBy?: number;
  readonly repository: MediaFileRepository;
};

export type SavedMediaFile = Omit<MediaFileRecord, 'metadata' | 'uploadedBy'>;

export type ByteRange = { readonly start: number; readonly end: number };

export type PrepareMediaReadInput = {
  readonly root: MediaRoot;
  readonly relativePath: string;
  readonly method: 'GET' | 'HEAD';
  readonly rangeHeader?: string;
};

export type MediaReadPlan = {
  readonly status: 200 | 206;
  readonly contentLength: number;
  readonly sizeBytes: number;
  readonly range: ByteRange | null;
  readonly body: ReadStream | null;
};

export function succeed<Value>(value: Value): MediaResult<Value> {
  return { ok: true, value };
}

export function fail(kind: MediaError['kind'], message: string): MediaResult<never> {
  return { ok: false, error: { kind, message } };
}

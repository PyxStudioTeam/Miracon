import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { ContentSnapshot, RevisionRecord } from './revision-contracts';
import { contentSnapshotSchema } from './revision-contracts';
import type { RevisionTransaction } from './revision-repository';

export class MaterializationError extends Error {
  readonly name = 'MaterializationError';
}

const unknownRecordSchema = z.record(z.string(), z.unknown());
const materializedSnapshotRowSchema = z.object({ snapshot: z.unknown() });

export function parseStoredSnapshot(value: unknown): ContentSnapshot {
  const direct = contentSnapshotSchema.safeParse(value);
  if (direct.success) return direct.data;
  const snapshot = unknownRecordSchema.parse(value);
  switch (snapshot['aggregateType']) {
    case 'project':
      return contentSnapshotSchema.parse({
        ...snapshot,
        project: normalizeRecordTimestamps(snapshot['project'], ['created_at', 'updated_at', 'published_at']),
        images: Array.isArray(snapshot['images'])
          ? snapshot['images'].map((image) => normalizeRecordTimestamps(image, ['created_at']))
          : snapshot['images'],
      });
    case 'homepage_hero':
      return contentSnapshotSchema.parse({
        ...snapshot,
        videos: Array.isArray(snapshot['videos'])
          ? snapshot['videos'].map((video) => normalizeRecordTimestamps(video, ['created_at', 'updated_at']))
          : snapshot['videos'],
      });
    case 'site_settings':
      return contentSnapshotSchema.parse({ ...snapshot, settings: normalizeRecordTimestamps(snapshot['settings'], ['updated_at']) });
    default:
      return contentSnapshotSchema.parse(snapshot);
  }
}

function normalizeRecordTimestamps(value: unknown, keys: readonly string[]): unknown {
  const record = unknownRecordSchema.safeParse(value);
  if (!record.success) return value;
  return Object.fromEntries(Object.entries(record.data).map(([key, entry]) =>
    [key, keys.includes(key) && typeof entry === 'string' ? new Date(entry).toISOString() : entry]));
}

export async function materializeSnapshot(
  transaction: RevisionTransaction,
  revision: RevisionRecord,
): Promise<void> {
  const result = await transaction.query(
    '/* revision:materialize-revision */ select miracon.materialize_content_revision($1::uuid) as snapshot',
    [revision.id],
  );
  const row = materializedSnapshotRowSchema.parse(result.rows[0]);
  const materialized = parseStoredSnapshot(row.snapshot);
  if (!isDeepStrictEqual(materialized, revision.snapshot)) {
    throw new MaterializationError('Canonical content differs from the approved revision snapshot');
  }
}

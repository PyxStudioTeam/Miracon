import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { sourceRows } from '../migration-tests/fixtures.mjs';
import { buildSnapshot } from '../scripts/migration/transfer-contract.mjs';
import { transformSupabaseSnapshot } from '../scripts/migration/transform-supabase.mjs';

export async function importFixture() {
  const directory = new URL('../postgres/migrations/', import.meta.url);
  const targetMigrations = await Promise.all((await readdir(directory)).filter((name) => name.endsWith('.sql')).sort().map(async (filename) => ({
    filename, sha256: createHash('sha256').update(await readFile(new URL(filename, directory))).digest('hex'),
  })));
  const input = structuredClone(sourceRows);
  input.targetMigrations = targetMigrations;
  const snapshot = buildSnapshot({ content: transformSupabaseSnapshot(input), exportedAt: '2026-08-12T10:00:00.000Z' });
  const grouped = new Map();
  for (const reference of snapshot.content.mediaReferences.filter((item) => item.transferCandidate)) {
    const key = `${reference.bucket}/${reference.objectPath}`;
    const hash = createHash('sha256').update(key).digest('hex');
    const extension = reference.objectPath.endsWith('.pdf') ? 'pdf' : reference.objectPath.endsWith('.mp4') ? 'mp4' : 'webp';
    const record = grouped.get(key) ?? {
      key, bucket: reference.bucket, objectPath: reference.objectPath, references: [], status: 'completed', bytes: 123,
      sha256: hash, mimeType: extension === 'pdf' ? 'application/pdf' : extension === 'mp4' ? 'video/mp4' : 'image/webp',
      relativePath: `imports/${reference.bucket}/${hash}-${basename(reference.objectPath, `.${extension}`)}.${extension}`,
      relativeUrl: `/media/imports/${reference.bucket}/${hash}-${basename(reference.objectPath, `.${extension}`)}.${extension}`,
    };
    record.references.push(reference.originalUrl);
    grouped.set(key, record);
  }
  return { snapshot, targetMigrations, mediaState: { version: 'miracon-media-transfer/v1', snapshotId: snapshot.snapshotId, contentHash: snapshot.contentHash, records: [...grouped.values()] } };
}

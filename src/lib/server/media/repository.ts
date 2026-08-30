import type { MediaFileRepository } from './types';

export interface MediaDatabase {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

export function createMediaFileRepository(database: MediaDatabase): MediaFileRepository {
  return {
    async insert(record) {
      await database.query(`
        insert into miracon.media_files (
          id, relative_url, relative_path, original_name, mime_type, size_bytes, sha256, metadata, uploaded_by
        ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
      `, [
        record.id,
        record.relativeUrl,
        record.relativePath,
        record.originalName,
        record.mimeType,
        record.sizeBytes,
        record.sha256,
        JSON.stringify(record.metadata),
        record.uploadedBy,
      ]);
    },
  };
}

import { Readable } from 'node:stream';
import { z } from 'zod';
import { json, jsonError, requireAdminMutation } from '../../../lib/server/api';
import type { ApiContext } from '../../../lib/server/api';
import { getDatabasePool } from '../../../lib/server/database';
import { MEDIA_UPLOAD_REQUEST_MAX_BYTES, createMediaFileRepository, getMediaRoot, saveMediaFile } from '../../../lib/server/media';

const uploadSchema = z.object({ file: z.instanceof(File) });

export async function POST({ request }: ApiContext): Promise<Response> {
  const session = await requireAdminMutation(request);
  if (!session.ok) return session.response;
  const contentLength = request.headers.get('content-length');
  if (!contentLength) return jsonError(411, 'invalid_request', 'Content-Length is required');
  if (!/^\d+$/u.test(contentLength) || Number(contentLength) > MEDIA_UPLOAD_REQUEST_MAX_BYTES) {
    return jsonError(413, 'invalid_upload', 'Request body exceeds the media upload limit');
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch (error) {
    if (error instanceof TypeError) return jsonError(400, 'invalid_request', 'Request body must be multipart form data');
    throw error;
  }
  const parsed = uploadSchema.safeParse({ file: form.get('file') });
  if (!parsed.success) return jsonError(400, 'invalid_upload', 'A media file is required');

  const root = await getMediaRoot();
  if (!root.ok) return jsonError(503, 'media_unavailable', 'Media storage is unavailable');
  const saved = await saveMediaFile({
    root: root.value,
    source: Readable.from(fileChunks(parsed.data.file)),
    mimeType: parsed.data.file.type,
    originalName: parsed.data.file.name,
    uploadedBy: session.value.session.adminUserId,
    repository: createMediaFileRepository(getDatabasePool()),
  });
  if (!saved.ok) return jsonError(400, saved.error.kind, saved.error.message);
  return json({
    media: {
      ...saved.value,
      sha256: saved.value.sha256.toString('hex'),
    },
  }, { status: 201 });
}

async function* fileChunks(file: File): AsyncGenerator<Uint8Array> {
  const reader = file.stream().getReader();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      yield chunk.value;
    }
  } finally {
    reader.releaseLock();
  }
}

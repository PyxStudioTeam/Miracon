import { Readable } from 'node:stream';
import { z } from 'zod';
import { jsonError } from '../../lib/server/api';
import type { ApiContext } from '../../lib/server/api';
import { getMediaRoot, prepareMediaRead } from '../../lib/server/media';

const pathSchema = z.string().min(1).max(2_048);
const immutableUploadPath = /^uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/\1\.(?:avif|jpg|mp4|pdf|png|svg|webp)$/iu;

const mimeTypes: Readonly<Record<string, string>> = {
  avif: 'image/avif', jpg: 'image/jpeg', mp4: 'video/mp4', pdf: 'application/pdf', png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp',
};

export async function GET(context: ApiContext): Promise<Response> {
  return serveMedia(context, 'GET');
}

export async function HEAD(context: ApiContext): Promise<Response> {
  return serveMedia(context, 'HEAD');
}

async function serveMedia({ request, params }: ApiContext, method: 'GET' | 'HEAD'): Promise<Response> {
  const relativePath = pathSchema.safeParse(params.path);
  if (!relativePath.success) return jsonError(404, 'not_found', 'Media file was not found');
  const root = await getMediaRoot();
  if (!root.ok) return jsonError(503, 'media_unavailable', 'Media storage is unavailable');
  const plan = await prepareMediaRead({
    root: root.value,
    relativePath: relativePath.data,
    method,
    rangeHeader: request.headers.get('range') ?? undefined,
  });
  if (!plan.ok) return mediaError(plan.error.kind);

  const headers = new Headers({
    'accept-ranges': 'bytes',
    'content-length': String(plan.value.contentLength),
    'content-type': mimeTypeFor(relativePath.data),
  });
  if (immutableUploadPath.test(relativePath.data)) headers.set('cache-control', 'public, max-age=31536000, immutable');
  if (plan.value.range) headers.set('content-range', `bytes ${plan.value.range.start}-${plan.value.range.end}/${plan.value.sizeBytes}`);
  return new Response(plan.value.body ? responseStream(plan.value.body) : null, { status: plan.value.status, headers });
}

function mimeTypeFor(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase();
  return extension ? mimeTypes[extension] ?? 'application/octet-stream' : 'application/octet-stream';
}

function mediaError(kind: string): Response {
  if (kind === 'range_not_satisfiable') return jsonError(416, kind, 'Requested range is not satisfiable');
  if (kind === 'not_found' || kind === 'unsafe_path') return jsonError(404, 'not_found', 'Media file was not found');
  return jsonError(500, 'media_unavailable', 'Media storage is unavailable');
}

function responseStream(stream: Readable): ReadableStream<Uint8Array> {
  const iterator = stream[Symbol.asyncIterator]();
  return new ReadableStream({
    async pull(controller) {
      const chunk = await iterator.next();
      if (chunk.done) {
        controller.close();
        return;
      }
      controller.enqueue(chunk.value);
    },
    cancel() {
      stream.destroy();
    },
  });
}

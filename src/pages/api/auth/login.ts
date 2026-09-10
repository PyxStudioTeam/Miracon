import { z } from 'zod';
import { createSessionCookie } from '../../../lib/server/auth/cookie';
import { authenticateAdminAndCreateSession } from '../../../lib/server/auth/login';
import { verifySameOriginMutation } from '../../../lib/server/auth/request-security';
import {
  SESSION_LIFETIME_SECONDS,
  json,
  jsonError,
  trustedClientAddress,
} from '../../../lib/server/api';
import type { ApiContext } from '../../../lib/server/api';
import { getDatabasePool } from '../../../lib/server/database';

const loginSchema = z.object({
  email: z.string().trim().pipe(z.email().max(320)),
  password: z.string().min(1).max(1_024),
});

const LOGIN_REQUEST_MAX_BYTES = 8 * 1_024;

type ParsedLoginJson =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly response: Response };

export async function POST({ request, clientAddress }: ApiContext): Promise<Response> {
  if (!verifySameOriginMutation(request.method, request.headers.get('origin'), request.url)) {
    return jsonError(403, 'origin_failed', 'Origin validation failed');
  }
  const body = await parseBoundedLoginJson(request);
  if (!body.ok) return body.response;
  const input = loginSchema.safeParse(body.value);
  if (!input.success) return jsonError(401, 'invalid_credentials', 'Invalid email or password');

  const now = new Date();
  const database = getDatabasePool();
  const authentication = await authenticateAdminAndCreateSession(database, {
    email: input.data.email,
    password: input.data.password,
    clientAddress: trustedClientAddress(clientAddress),
    now,
  }, {
    now,
    ttlMs: SESSION_LIFETIME_SECONDS * 1_000,
  });
  if (!authentication.ok) return jsonError(401, 'invalid_credentials', 'Invalid email or password');

  const { session } = authentication;
  return json(
    { authenticated: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt.toISOString() },
    { headers: { 'set-cookie': createSessionCookie(session.sessionToken, SESSION_LIFETIME_SECONDS) } },
  );
}

async function parseBoundedLoginJson(request: Request): Promise<ParsedLoginJson> {
  const contentLength = request.headers.get('content-length');
  const isChunked = request.headers.get('transfer-encoding')
    ?.split(',')
    .some((encoding) => encoding.trim().toLowerCase() === 'chunked') ?? false;
  if (contentLength === null && !isChunked) {
    return { ok: false, response: jsonError(411, 'invalid_request', 'Content-Length is required') };
  }
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength)) {
      return {
        ok: false,
        response: jsonError(400, 'invalid_request', 'Content-Length must be a decimal byte count'),
      };
    }
    if (Number(contentLength) > LOGIN_REQUEST_MAX_BYTES) {
      return { ok: false, response: loginBodyTooLarge() };
    }
  }

  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  if (reader) {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        byteLength += chunk.value.byteLength;
        if (byteLength > LOGIN_REQUEST_MAX_BYTES) {
          await reader.cancel();
          return { ok: false, response: loginBodyTooLarge() };
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      return {
        ok: false,
        response: jsonError(400, 'invalid_request', 'Request body must be valid JSON'),
      };
    }
    throw error;
  }
}

function loginBodyTooLarge(): Response {
  return jsonError(413, 'invalid_request', 'Request body exceeds the login limit');
}

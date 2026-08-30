import { z } from 'zod';
import { createSessionCookie } from '../../../lib/server/auth/cookie';
import { authenticateAdminAndCreateSession } from '../../../lib/server/auth/login';
import { verifySameOriginMutation } from '../../../lib/server/auth/request-security';
import {
  SESSION_LIFETIME_SECONDS,
  json,
  jsonError,
  parseJson,
  trustedClientAddress,
} from '../../../lib/server/api';
import type { ApiContext } from '../../../lib/server/api';
import { getDatabasePool } from '../../../lib/server/database';

const loginSchema = z.object({
  email: z.string().trim().pipe(z.email().max(320)),
  password: z.string().min(1).max(1_024),
});

export async function POST({ request, clientAddress }: ApiContext): Promise<Response> {
  if (!verifySameOriginMutation(request.method, request.headers.get('origin'), request.url)) {
    return jsonError(403, 'origin_failed', 'Origin validation failed');
  }
  const input = await parseJson(request, loginSchema);
  if (!input.ok) return jsonError(401, 'invalid_credentials', 'Invalid email or password');

  const now = new Date();
  const database = getDatabasePool();
  const authentication = await authenticateAdminAndCreateSession(database, {
    email: input.value.email,
    password: input.value.password,
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

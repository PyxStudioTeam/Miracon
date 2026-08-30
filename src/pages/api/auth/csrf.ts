import { verifySameOriginMutation } from '../../../lib/server/auth/request-security';
import { rotateSessionCsrf } from '../../../lib/server/auth/session';
import { json, jsonError, requireSession } from '../../../lib/server/api';
import type { ApiContext } from '../../../lib/server/api';
import { getDatabasePool } from '../../../lib/server/database';

export async function POST({ request }: ApiContext): Promise<Response> {
  const result = await requireSession(request);
  if (!result.ok) return result.response;
  if (!verifySameOriginMutation(request.method, request.headers.get('origin'), request.url)) {
    return jsonError(403, 'origin_failed', 'Origin validation failed');
  }
  const csrfToken = await rotateSessionCsrf(getDatabasePool(), result.value.session.id);
  return json({ csrfToken });
}

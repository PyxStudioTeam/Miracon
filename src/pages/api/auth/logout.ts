import { clearSessionCookie } from '../../../lib/server/auth/cookie';
import { revokeSession } from '../../../lib/server/auth/session';
import { requireAdminMutation } from '../../../lib/server/api';
import type { ApiContext } from '../../../lib/server/api';
import { getDatabasePool } from '../../../lib/server/database';

export async function POST({ request }: ApiContext): Promise<Response> {
  const result = await requireAdminMutation(request);
  if (!result.ok) return result.response;
  await revokeSession(getDatabasePool(), result.value.sessionToken, new Date());
  return new Response(null, { status: 204, headers: { 'set-cookie': clearSessionCookie() } });
}

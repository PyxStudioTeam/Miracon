import { touchSession } from '../../../lib/server/auth/session';
import { json, jsonError, requireAdminMutation } from '../../../lib/server/api';
import type { ApiContext } from '../../../lib/server/api';
import { getDatabasePool } from '../../../lib/server/database';

export async function POST({ request }: ApiContext): Promise<Response> {
  const guarded = await requireAdminMutation(request);
  if (!guarded.ok) return guarded.response;
  const session = await touchSession(getDatabasePool(), guarded.value.sessionToken, new Date());
  if (!session) return jsonError(401, 'unauthorized', 'Authentication is required');
  return json({ expiresAt: session.expiresAt.toISOString(), idleExpiresAt: session.idleExpiresAt.toISOString() });
}

import { json, requireSession } from '../../../lib/server/api';
import type { ApiContext } from '../../../lib/server/api';

export async function GET({ request }: ApiContext): Promise<Response> {
  const result = await requireSession(request);
  if (!result.ok) return result.response;
  return json({
    authenticated: true,
    expiresAt: result.value.session.expiresAt.toISOString(),
    role: result.value.session.role,
    email: result.value.session.email,
    adminUserId: result.value.session.adminUserId,
  });
}

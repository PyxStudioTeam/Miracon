import { z } from 'zod';
import {
  jsonError,
  requireAdminMutationCapability,
} from '../../../../../lib/server/api';
import type { ApiContext } from '../../../../../lib/server/api';
import { getDatabasePool } from '../../../../../lib/server/database';
import {
  revokeUserSessions,
  UserManagementError,
} from '../../../../../lib/server/users';

const adminIdParamSchema = z.coerce.number().int().positive();

export async function POST({ request, params }: ApiContext): Promise<Response> {
  const session = await requireAdminMutationCapability(request, 'manageEditors');
  if (!session.ok) return session.response;

  const adminIdResult = adminIdParamSchema.safeParse(params.id);
  if (!adminIdResult.success) {
    return jsonError(400, 'invalid_request', 'Invalid administrator ID');
  }

  try {
    await revokeUserSessions(getDatabasePool(), adminIdResult.data);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof UserManagementError) {
      return jsonError(400, error.code, error.message);
    }
    throw error;
  }
}

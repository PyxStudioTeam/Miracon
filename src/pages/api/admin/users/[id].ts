import { z } from 'zod';
import {
  jsonError,
  parseJson,
  requireAdminMutationCapability,
} from '../../../../lib/server/api';
import type { ApiContext } from '../../../../lib/server/api';
import { getDatabasePool } from '../../../../lib/server/database';
import {
  deactivateEditorUser,
  rotateUserCredentials,
  UserManagementError,
} from '../../../../lib/server/users';

const adminIdParamSchema = z.coerce.number().int().positive();

const rotateUserSchema = z.object({
  email: z.string().trim().min(1).optional(),
  password: z.string().min(1).optional(),
}).strict().refine((data) => data.email !== undefined || data.password !== undefined, {
  message: 'At least email or password must be provided',
});

export async function PUT({ request, params }: ApiContext): Promise<Response> {
  const session = await requireAdminMutationCapability(request, 'manageEditors');
  if (!session.ok) return session.response;

  const adminIdResult = adminIdParamSchema.safeParse(params.id);
  if (!adminIdResult.success) {
    return jsonError(400, 'invalid_request', 'Invalid administrator ID');
  }

  const input = await parseJson(request, rotateUserSchema);
  if (!input.ok) return input.response;

  try {
    await rotateUserCredentials(
      getDatabasePool(),
      adminIdResult.data,
      input.value.email,
      input.value.password,
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof UserManagementError) {
      return jsonError(400, error.code, error.message);
    }
    throw error;
  }
}

export async function DELETE({ request, params }: ApiContext): Promise<Response> {
  const session = await requireAdminMutationCapability(request, 'manageEditors');
  if (!session.ok) return session.response;

  const adminIdResult = adminIdParamSchema.safeParse(params.id);
  if (!adminIdResult.success) {
    return jsonError(400, 'invalid_request', 'Invalid administrator ID');
  }

  try {
    await deactivateEditorUser(getDatabasePool(), adminIdResult.data);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof UserManagementError) {
      return jsonError(400, error.code, error.message);
    }
    throw error;
  }
}

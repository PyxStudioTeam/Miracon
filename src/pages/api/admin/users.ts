import { z } from 'zod';
import {
  json,
  jsonError,
  parseJson,
  requireAdminMutationCapability,
  requireSessionCapability,
} from '../../../lib/server/api';
import type { ApiContext } from '../../../lib/server/api';
import { getDatabasePool } from '../../../lib/server/database';
import {
  createEditorUser,
  listAdminUsers,
  UserManagementError,
} from '../../../lib/server/users';

const createEditorSchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
}).strict();

export async function GET({ request }: ApiContext): Promise<Response> {
  const session = await requireSessionCapability(request, 'manageEditors');
  if (!session.ok) return session.response;
  const users = await listAdminUsers(getDatabasePool());
  return json({ users });
}

export async function POST({ request }: ApiContext): Promise<Response> {
  const session = await requireAdminMutationCapability(request, 'manageEditors');
  if (!session.ok) return session.response;
  const input = await parseJson(request, createEditorSchema);
  if (!input.ok) return input.response;

  try {
    const user = await createEditorUser(getDatabasePool(), input.value.email, input.value.password);
    return json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof UserManagementError) {
      return jsonError(400, error.code, error.message);
    }
    throw error;
  }
}

import { parseJson, requireAdminMutationCapability } from '../../../../lib/server/api';
import type { ApiContext } from '../../../../lib/server/api';
import { reorderSchema } from '../../../../lib/server/api-schemas';
import { getDatabasePool } from '../../../../lib/server/database';
import { reorderProjects } from '../../../../lib/server/projects';

export async function POST({ request }: ApiContext): Promise<Response> {
  const session = await requireAdminMutationCapability(request, 'reorderProjects');
  if (!session.ok) return session.response;
  const input = await parseJson(request, reorderSchema);
  if (!input.ok) return input.response;
  await reorderProjects(getDatabasePool(), input.value.items);
  return new Response(null, { status: 204 });
}

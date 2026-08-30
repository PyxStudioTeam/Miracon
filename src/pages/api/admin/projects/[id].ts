import { z } from 'zod';
import { jsonError, parseJson, requireAdminMutation } from '../../../../lib/server/api';
import type { ApiContext } from '../../../../lib/server/api';
import { getDatabasePool } from '../../../../lib/server/database';
import {
  deleteProjectMutationSchema,
  revisionExceptionResponse,
  revisionResultErrorResponse,
} from '../../../../lib/server/project-revision-http';
import { RevisionService } from '../../../../lib/server/revisions';

const projectIdSchema = z.string().min(1).max(128);

export async function DELETE({ request, params }: ApiContext): Promise<Response> {
  const session = await requireAdminMutation(request);
  if (!session.ok) return session.response;
  const projectId = projectIdSchema.safeParse(params.id);
  if (!projectId.success) return jsonError(400, 'invalid_request', 'Project ID is invalid');
  const input = await parseJson(request, deleteProjectMutationSchema);
  if (!input.ok) return input.response;
  try {
    const result = await new RevisionService(getDatabasePool()).execute(session.value.sessionToken, {
      action: 'delete',
      aggregateType: 'project',
      aggregateId: projectId.data,
      expectedCurrentRevisionId: input.value.expectedCurrentRevisionId,
    });
    if (!result.ok) return revisionResultErrorResponse(result.error);
    return new Response(null, { status: 204 });
  } catch (error) {
    const response = revisionExceptionResponse(error);
    if (response) return response;
    throw error;
  }
}

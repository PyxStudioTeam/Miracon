import { z } from 'zod';
import {
  json,
  jsonError,
  parseJson,
  requireAdminMutationCapability,
} from '../../../../../lib/server/api';
import type { ApiContext } from '../../../../../lib/server/api';
import { getDatabasePool } from '../../../../../lib/server/database';
import {
  revisionExceptionResponse,
  revisionResultErrorResponse,
} from '../../../../../lib/server/project-revision-http';
import { revisionIdSchema } from '../../../../../lib/server/revision-contracts';
import { RevisionService } from '../../../../../lib/server/revisions';

const rejectSchema = z.object({
  expectedCurrentRevisionId: revisionIdSchema.nullable(),
}).strict();

export async function POST({ request, params }: ApiContext): Promise<Response> {
  const session = await requireAdminMutationCapability(request, 'rejectRevision');
  if (!session.ok) return session.response;

  const revisionIdResult = revisionIdSchema.safeParse(params.id);
  if (!revisionIdResult.success) {
    return jsonError(400, 'invalid_request', 'Invalid revision ID');
  }

  const input = await parseJson(request, rejectSchema);
  if (!input.ok) return input.response;

  try {
    const result = await new RevisionService(getDatabasePool()).execute(
      session.value.sessionToken,
      {
        action: 'reject',
        revisionId: revisionIdResult.data,
        expectedCurrentRevisionId: input.value.expectedCurrentRevisionId,
      },
    );

    if (!result.ok) return revisionResultErrorResponse(result.error);
    return json({ revision: result.value });
  } catch (error) {
    const response = revisionExceptionResponse(error);
    if (response) return response;
    throw error;
  }
}

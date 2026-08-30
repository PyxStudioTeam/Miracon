import { z } from 'zod';
import {
  json,
  parseJson,
  requireAdminMutationCapability,
} from '../../../../lib/server/api';
import type { ApiContext } from '../../../../lib/server/api';
import { getDatabasePool } from '../../../../lib/server/database';
import {
  revisionExceptionResponse,
  revisionResultErrorResponse,
} from '../../../../lib/server/project-revision-http';
import { revisionIdSchema } from '../../../../lib/server/revision-contracts';
import { RevisionService } from '../../../../lib/server/revisions';

const rollbackSchema = z.object({
  targetRevisionId: revisionIdSchema,
  expectedCurrentRevisionId: revisionIdSchema,
}).strict();

export async function POST({ request }: ApiContext): Promise<Response> {
  const session = await requireAdminMutationCapability(request, 'rollbackRevision');
  if (!session.ok) return session.response;

  const input = await parseJson(request, rollbackSchema);
  if (!input.ok) return input.response;

  try {
    const result = await new RevisionService(getDatabasePool()).execute(
      session.value.sessionToken,
      {
        action: 'rollback',
        targetRevisionId: input.value.targetRevisionId,
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

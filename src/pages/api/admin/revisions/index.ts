import { z } from 'zod';
import {
  json,
  jsonError,
  requireSessionCapability,
} from '../../../../lib/server/api';
import type { ApiContext } from '../../../../lib/server/api';
import { getDatabasePool } from '../../../../lib/server/database';
import { contentAggregateTypeSchema } from '../../../../lib/server/revision-contracts';
import {
  getAggregateRevisionHistory,
  getPendingProposals,
} from '../../../../lib/server/revision-queries';

const querySchema = z.object({
  status: z.enum(['pending']).optional(),
  aggregateType: contentAggregateTypeSchema.optional(),
  aggregateId: z.string().min(1).optional(),
});

export async function GET({ request }: ApiContext): Promise<Response> {
  const session = await requireSessionCapability(request, 'readAdmin');
  if (!session.ok) return session.response;

  const url = new URL(request.url);
  const rawParams = {
    status: url.searchParams.get('status') ?? undefined,
    aggregateType: url.searchParams.get('aggregateType') ?? undefined,
    aggregateId: url.searchParams.get('aggregateId') ?? undefined,
  };

  const parsed = querySchema.safeParse(rawParams);
  if (!parsed.success) {
    return jsonError(400, 'invalid_request', 'Invalid query parameters');
  }

  const database = getDatabasePool();
  if (parsed.data.status === 'pending') {
    const proposals = await getPendingProposals(database);
    return json({ proposals });
  }

  if (parsed.data.aggregateType && parsed.data.aggregateId) {
    const revisions = await getAggregateRevisionHistory(
      database,
      parsed.data.aggregateType,
      parsed.data.aggregateId,
    );
    return json({ revisions });
  }

  return jsonError(400, 'invalid_request', 'Specify either status=pending or aggregateType and aggregateId');
}

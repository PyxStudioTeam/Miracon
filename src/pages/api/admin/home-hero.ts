import { z } from 'zod';
import { json, parseJson, requireAdminMutation, requireSession } from '../../../lib/server/api';
import type { ApiContext } from '../../../lib/server/api';
import { homepageVideosSchema } from '../../../lib/server/api-schemas';
import { getDatabasePool } from '../../../lib/server/database';
import { buildHomepageHeroRevisionTransport } from '../../../lib/server/homepage-revision-adapter';
import { getHomepageVideosWithHead } from '../../../lib/server/homepage-videos';
import {
  revisionExceptionResponse,
  revisionResultErrorResponse,
} from '../../../lib/server/project-revision-http';
import {
  revisionIdSchema,
  SINGLETON_AGGREGATE_ID,
} from '../../../lib/server/revision-contracts';
import { getAggregateHeadRevision } from '../../../lib/server/revision-queries';
import { RevisionService } from '../../../lib/server/revisions';

const homeHeroSaveInputSchema = z.object({
  videos: homepageVideosSchema.shape.videos,
  expectedRevisionId: revisionIdSchema.nullable().optional(),
  mediaFileIds: z.array(z.string().min(1)).optional(),
});

export async function GET({ request }: ApiContext): Promise<Response> {
  const session = await requireSession(request);
  if (!session.ok) return session.response;
  const { videos, currentRevisionId } = await getHomepageVideosWithHead(getDatabasePool());
  return json({
    videos,
    currentRevisionId,
  });
}

export async function PUT({ request }: ApiContext): Promise<Response> {
  const session = await requireAdminMutation(request);
  if (!session.ok) return session.response;
  const input = await parseJson(request, homeHeroSaveInputSchema);
  if (!input.ok) return input.response;

  const database = getDatabasePool();
  const head = await getAggregateHeadRevision(database, 'homepage_hero', SINGLETON_AGGREGATE_ID);
  const currentRevisionId = head?.currentRevisionId ?? null;
  const expectedRevisionId = input.value.expectedRevisionId !== undefined
    ? input.value.expectedRevisionId
    : currentRevisionId;

  if (input.value.expectedRevisionId !== undefined && expectedRevisionId !== currentRevisionId) {
    return revisionResultErrorResponse({
      kind: 'revision_conflict',
      expectedRevisionId,
      currentRevisionId,
    });
  }

  const previousSnapshot = head?.snapshot.aggregateType === 'homepage_hero' ? head.snapshot : null;
  const mutationTime = new Date().toISOString();

  // Collect media file IDs
  let mediaFileIds = input.value.mediaFileIds ?? [];
  if (mediaFileIds.length === 0) {
    const urls = input.value.videos.flatMap((v) => [v.desktopUrl, v.mobileUrl]).filter((url): url is string => Boolean(url));
    if (urls.length > 0) {
      const mediaResult = await database.query('select id from miracon.media_files where relative_url = any($1::text[])', [urls]);
      mediaFileIds = mediaResult.rows.map((row) => String(row['id']));
    }
  }

  const transport = buildHomepageHeroRevisionTransport({
    videos: input.value.videos,
    previousSnapshot,
    expectedRevisionId,
    mediaFileIds,
    mutationTime,
  });

  const isEditor = session.value.session.role === 'editor';
  try {
    const command = isEditor
      ? { action: 'proposal' as const, ...transport }
      : { action: 'publish' as const, ...transport, confirmPublish: true as const };

    const result = await new RevisionService(database).execute(session.value.sessionToken, command);
    if (!result.ok) return revisionResultErrorResponse(result.error);

    const updated = await getHomepageVideosWithHead(database);
    return json({
      videos: updated.videos,
      currentRevisionId: updated.currentRevisionId,
      revision: result.value,
      isProposal: isEditor,
    });
  } catch (error) {
    const response = revisionExceptionResponse(error);
    if (response) return response;
    throw error;
  }
}

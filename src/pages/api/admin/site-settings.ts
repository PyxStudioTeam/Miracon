import { z } from 'zod';
import { json, jsonError, parseJson, requireAdminMutation, requireSession } from '../../../lib/server/api';
import type { ApiContext } from '../../../lib/server/api';
import { siteSettingsSchema } from '../../../lib/server/api-schemas';
import { getDatabasePool } from '../../../lib/server/database';
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
import { getSiteSettingsWithHead } from '../../../lib/server/site-settings';
import { buildSiteSettingsRevisionTransport } from '../../../lib/server/site-settings-revision-adapter';

const siteSettingsSaveInputSchema = siteSettingsSchema.extend({
  expectedRevisionId: revisionIdSchema.nullable().optional(),
  mediaFileIds: z.array(z.string().min(1)).optional(),
});

export async function GET({ request }: ApiContext): Promise<Response> {
  const session = await requireSession(request);
  if (!session.ok) return session.response;
  const { settings, currentRevisionId } = await getSiteSettingsWithHead(getDatabasePool());
  return json({
    settings,
    currentRevisionId,
  });
}

export async function PUT({ request }: ApiContext): Promise<Response> {
  const session = await requireAdminMutation(request);
  if (!session.ok) return session.response;
  const input = await parseJson(request, siteSettingsSaveInputSchema);
  if (!input.ok) return input.response;

  const database = getDatabasePool();
  const head = await getAggregateHeadRevision(database, 'site_settings', SINGLETON_AGGREGATE_ID);
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

  const mutationTime = new Date().toISOString();

  // Validate and collect media file IDs for any uploaded PDFs
  const legalUrls = [
    input.value.footerTermsPdfUrl,
    input.value.footerPrivacyPdfUrl,
    input.value.footerCookiePdfUrl,
  ].filter((url): url is string => Boolean(url && url.trim()));

  const uniqueLegalUrls = [...new Set(legalUrls)];
  let resolvedMediaIds: string[] = [];

  if (uniqueLegalUrls.length > 0) {
    const mediaResult = await database.query<{ readonly id: string; readonly relative_url: string; readonly mime_type: string }>(
      'select id, relative_url, mime_type from miracon.media_files where relative_url = any($1::text[])',
      [uniqueLegalUrls],
    );

    if (mediaResult.rows.length !== uniqueLegalUrls.length) {
      return jsonError(400, 'invalid_media', 'Legal documents must reference existing uploaded PDF files');
    }

    const nonPdf = mediaResult.rows.some((row) => row.mime_type !== 'application/pdf');
    if (nonPdf) {
      return jsonError(400, 'invalid_media', 'Legal documents must be PDF files');
    }

    resolvedMediaIds = mediaResult.rows.map((row) => String(row.id));
  }

  const mediaFileIds = [...new Set([...(input.value.mediaFileIds ?? []), ...resolvedMediaIds])];

  const transport = buildSiteSettingsRevisionTransport({
    settings: {
      footerTermsVisible: input.value.footerTermsVisible,
      footerTermsPdfUrl: input.value.footerTermsPdfUrl,
      footerPrivacyVisible: input.value.footerPrivacyVisible,
      footerPrivacyPdfUrl: input.value.footerPrivacyPdfUrl,
      footerCookieVisible: input.value.footerCookieVisible,
      footerCookiePdfUrl: input.value.footerCookiePdfUrl,
    },
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

    const { settings: updatedSettings, currentRevisionId: updatedRevisionId } = await getSiteSettingsWithHead(database);
    return json({
      settings: updatedSettings,
      currentRevisionId: updatedRevisionId,
      revision: result.value,
      isProposal: isEditor,
    });
  } catch (error) {
    const response = revisionExceptionResponse(error);
    if (response) return response;
    throw error;
  }
}

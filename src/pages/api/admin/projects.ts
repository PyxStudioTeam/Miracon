import { json, jsonError, parseJson, requireAdminMutation, requireSession } from '../../../lib/server/api';
import type { ApiContext } from '../../../lib/server/api';
import { getDatabasePool } from '../../../lib/server/database';
import { buildProjectRevisionTransport, extractProjectMediaReferences } from '../../../lib/server/project-revision-adapter';
import {
  deriveProjectRevisionTimestamps,
  projectOwnerSaveSchema,
  revisionExceptionResponse,
  revisionResultErrorResponse,
} from '../../../lib/server/project-revision-http';
import {
  getAdminProjectRevisionTransport,
  getAdminProjectRevisionTransports,
  loadProjectRevisionHead,
} from '../../../lib/server/project-revision-store';
import type { RevisionError } from '../../../lib/server/revision-contracts';
import { RevisionPersistenceError, RevisionService } from '../../../lib/server/revisions';

export async function GET({ request }: ApiContext): Promise<Response> {
  const session = await requireSession(request);
  if (!session.ok) return session.response;
  return json({ projects: await getAdminProjectRevisionTransports(getDatabasePool()) });
}

export async function POST({ request }: ApiContext): Promise<Response> {
  const session = await requireAdminMutation(request);
  if (!session.ok) return session.response;
  const input = await parseJson(request, projectOwnerSaveSchema);
  if (!input.ok) return input.response;
  const database = getDatabasePool();
  const head = await loadProjectRevisionHead(database, input.value.project.id);
  const currentRevisionId = head?.currentRevisionId ?? null;
  if (currentRevisionId !== input.value.expectedRevisionId) {
    return revisionResultErrorResponse(revisionConflict(input.value.expectedRevisionId, currentRevisionId));
  }
  if (head?.snapshot.deleted) {
    return revisionResultErrorResponse({ kind: 'aggregate_not_found', aggregateType: 'project', aggregateId: input.value.project.id });
  }

  const mutationTime = new Date().toISOString();
  const project = { ...input.value.project, updatedAt: mutationTime };

  const explicitMediaFileIds = input.value.mediaFileIds ?? [];
  if (explicitMediaFileIds.length > 0) {
    const explicitResult = await database.query<{ readonly id: string }>(
      'select id from miracon.media_files where id = any($1::text[])',
      [explicitMediaFileIds],
    );
    const foundExplicitIds = new Set(explicitResult.rows.map((row) => String(row.id)));
    if (explicitMediaFileIds.some((id) => !foundExplicitIds.has(id))) {
      return jsonError(400, 'invalid_media', 'Project references non-existent media files');
    }
  }

  const references = extractProjectMediaReferences(project);
  const managedRefs = [...new Set(references.filter((ref) => ref.startsWith('/media/') || ref.startsWith('uploads/')))];
  let resolvedIds: string[] = [];

  if (managedRefs.length > 0) {
    const mediaResult = await database.query<{ readonly id: string; readonly relative_url: string; readonly relative_path: string }>(
      'select id, relative_url, relative_path from miracon.media_files where relative_url = any($1::text[]) or relative_path = any($1::text[])',
      [managedRefs],
    );
    const foundRefs = new Set(mediaResult.rows.flatMap((row) => [row.relative_url, row.relative_path]));
    if (managedRefs.some((ref) => !foundRefs.has(ref))) {
      return jsonError(400, 'invalid_media', 'Project references non-existent media files');
    }
    resolvedIds = mediaResult.rows.map((row) => String(row.id));
  }

  const mediaFileIds = [...new Set([...explicitMediaFileIds, ...resolvedIds])];

  const transport = buildProjectRevisionTransport({
    project,
    timestamps: deriveProjectRevisionTimestamps(project, head?.snapshot ?? null, mutationTime),
    expectedRevisionId: input.value.expectedRevisionId,
    mediaFileIds,
  });
  const isEditor = session.value.session.role === 'editor';
  try {
    const command = isEditor
      ? { action: 'proposal' as const, ...transport }
      : { action: 'publish' as const, ...transport, confirmPublish: true as const };

    const result = await new RevisionService(database).execute(session.value.sessionToken, command);
    if (!result.ok) return revisionResultErrorResponse(result.error);

    if (isEditor) {
      return json({
        project: {
          ...project,
          currentRevisionId,
        },
        revision: result.value,
        isProposal: true,
      }, { status: 201 });
    }

    const saved = await getAdminProjectRevisionTransport(database, project.id);
    if (!saved) throw new RevisionPersistenceError();
    return json({ project: saved, revision: result.value, isProposal: false }, { status: 201 });
  } catch (error) {
    const response = revisionExceptionResponse(error);
    if (response) return response;
    throw error;
  }
}

const revisionConflict = (expectedRevisionId: string | null, currentRevisionId: string | null): RevisionError => ({
  kind: 'revision_conflict', expectedRevisionId, currentRevisionId,
});

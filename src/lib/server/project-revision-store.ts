import { z } from 'zod';
import type { Project } from '../project-types';
import { getAdminProjects, type ProjectDatabase } from './projects';
import { parseStoredSnapshot } from './revision-materializers';
import { projectSnapshotSchema, revisionIdSchema, type ProjectSnapshot } from './revision-contracts';

export type ManagedMediaTransport = {
  readonly id: string;
  readonly relativeUrl: string;
  readonly relativePath: string;
};

export type AdminProjectRevisionTransport = Project & {
  readonly currentRevisionId: string;
  readonly managedMedia: readonly ManagedMediaTransport[];
};

export type ProjectRevisionHead = {
  readonly currentRevisionId: string;
  readonly snapshot: ProjectSnapshot;
};

const managedMediaSchema = z.object({
  id: z.string().min(1).max(128),
  relativeUrl: z.string().min(1).max(2_048),
  relativePath: z.string().min(1).max(2_048),
}).strict();

const projectRevisionMetadataRowSchema = z.object({
  aggregate_id: z.string().min(1).max(128),
  current_revision_id: revisionIdSchema,
  managed_media: z.array(managedMediaSchema),
});

const projectRevisionHeadRowSchema = z.object({
  current_revision_id: revisionIdSchema,
  snapshot: z.unknown(),
});

export class ProjectRevisionReadError extends Error {
  readonly name = 'ProjectRevisionReadError';
  constructor() { super('Project revision metadata is inconsistent'); }
}

export function parseProjectRevisionMetadataRows(rows: readonly unknown[]): ReadonlyMap<string, {
  readonly currentRevisionId: string;
  readonly managedMedia: readonly ManagedMediaTransport[];
}> {
  return new Map(rows.map((value) => {
    const row = projectRevisionMetadataRowSchema.parse(value);
    return [row.aggregate_id, { currentRevisionId: row.current_revision_id, managedMedia: row.managed_media }];
  }));
}

export async function getAdminProjectRevisionTransports(
  database: ProjectDatabase,
): Promise<AdminProjectRevisionTransport[]> {
  const [projects, metadataResult] = await Promise.all([
    getAdminProjects(database),
    database.query(`select head.aggregate_id, head.current_revision_id,
      coalesce(jsonb_agg(jsonb_build_object(
        'id', media.id, 'relativeUrl', media.relative_url, 'relativePath', media.relative_path
      ) order by media.id) filter (where media.id is not null), '[]'::jsonb) as managed_media
      from miracon.content_revision_heads as head
      join miracon.projects as project on project.id = head.aggregate_id
      left join miracon.revision_media as link on link.revision_id = head.current_revision_id
      left join miracon.media_files as media on media.id = link.media_file_id
      where head.aggregate_type = 'project'
      group by head.aggregate_id, head.current_revision_id`),
  ]);
  const metadata = parseProjectRevisionMetadataRows(metadataResult.rows);
  return projects.map((project) => {
    const revision = metadata.get(project.id);
    if (!revision) throw new ProjectRevisionReadError();
    return { ...project, ...revision };
  });
}

export async function getAdminProjectRevisionTransport(
  database: ProjectDatabase,
  projectId: string,
): Promise<AdminProjectRevisionTransport | null> {
  const projects = await getAdminProjectRevisionTransports(database);
  return projects.find((project) => project.id === projectId) ?? null;
}

export async function loadProjectRevisionHead(
  database: ProjectDatabase,
  projectId: string,
): Promise<ProjectRevisionHead | null> {
  const result = await database.query(`select head.current_revision_id, revision.snapshot
    from miracon.content_revision_heads as head
    join miracon.content_revisions as revision on revision.id = head.current_revision_id
    where head.aggregate_type = 'project' and head.aggregate_id = $1`, [projectId]);
  const row = result.rows[0];
  if (!row) return null;
  const parsed = projectRevisionHeadRowSchema.parse(row);
  return {
    currentRevisionId: parsed.current_revision_id,
    snapshot: projectSnapshotSchema.parse(parseStoredSnapshot(parsed.snapshot)),
  };
}

import { z } from 'zod';
import { mapProjectRow } from '../projects';
import type { Project } from '../project-types';
import type { ProjectDatabase } from './projects';
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

const adminProjectsWithHeadSelect = `
  select
    project.*,
    head.current_revision_id,
    coalesce(
      (
        select jsonb_agg(to_jsonb(image) order by image.sort_order)
        from miracon.project_images as image
        where image.project_id = project.id
      ),
      '[]'::jsonb
    ) as project_images,
    coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'id', media.id,
          'relativeUrl', media.relative_url,
          'relativePath', media.relative_path
        ) order by media.id)
        from miracon.revision_media as link
        join miracon.media_files as media on media.id = link.media_file_id
        where link.revision_id = head.current_revision_id
      ),
      '[]'::jsonb
    ) as managed_media
  from miracon.projects as project
  join miracon.content_revision_heads as head
    on head.aggregate_type = 'project' and head.aggregate_id = project.id
`;

type ProjectRevisionRow = Record<string, unknown> & {
  current_revision_id: string;
  managed_media: unknown[];
  project_images?: Record<string, unknown>[];
};

function mapAdminProjectRevisionTransportRow(row: ProjectRevisionRow): AdminProjectRevisionTransport {
  const project = mapProjectRow(row);
  const currentRevisionId = revisionIdSchema.parse(row.current_revision_id);
  const managedMedia = z.array(managedMediaSchema).parse(row.managed_media ?? []);
  return {
    ...project,
    currentRevisionId,
    managedMedia,
  };
}

export async function getAdminProjectRevisionTransports(
  database: ProjectDatabase,
): Promise<AdminProjectRevisionTransport[]> {
  const result = await database.query<ProjectRevisionRow>(`
    ${adminProjectsWithHeadSelect}
    order by project.sort_order
  `);
  return result.rows.map(mapAdminProjectRevisionTransportRow);
}

export async function getAdminProjectRevisionTransport(
  database: ProjectDatabase,
  projectId: string,
): Promise<AdminProjectRevisionTransport | null> {
  const result = await database.query<ProjectRevisionRow>(`
    ${adminProjectsWithHeadSelect}
    where project.id = $1
  `, [projectId]);
  const row = result.rows[0];
  return row ? mapAdminProjectRevisionTransportRow(row) : null;
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

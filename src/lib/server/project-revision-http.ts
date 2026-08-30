import { z } from 'zod';
import type { Project } from '../project-types';
import { jsonError } from './api';
import { projectSchema } from './api-schemas';
import type { ProjectRevisionTimestamps } from './project-revision-adapter';
import { revisionIdSchema, type ProjectSnapshot, type RevisionError } from './revision-contracts';
import {
  RevisionAccessError,
  RevisionCommandError,
  RevisionPersistenceError,
} from './revisions';

const mediaFileIdSchema = z.string().min(1).max(128);

export const projectOwnerSaveSchema = z.object({
  project: projectSchema,
  expectedRevisionId: revisionIdSchema.nullable(),
  mediaFileIds: z.array(mediaFileIdSchema)
    .refine((values) => new Set(values).size === values.length, 'Media file IDs must be unique'),
}).strict();

export const deleteProjectMutationSchema = z.object({
  expectedCurrentRevisionId: revisionIdSchema,
}).strict();

export function deriveProjectRevisionTimestamps(
  project: Project,
  currentSnapshot: ProjectSnapshot | null,
  mutationTime: string,
): ProjectRevisionTimestamps {
  const currentProject = currentSnapshot?.project ?? null;
  const previousImages = new Map(currentSnapshot?.images.map((image) => [image.id, image.created_at]) ?? []);
  const imageCreatedAt = Object.fromEntries(
    [...project.cardImages, ...project.gallery].map((image) => [image.id, previousImages.get(image.id) ?? mutationTime]),
  );
  return {
    createdAt: currentProject?.created_at ?? mutationTime,
    publishedAt: currentProject?.published_at ?? (project.status === 'published' ? mutationTime : null),
    imageCreatedAt,
  };
}

export function revisionExceptionResponse(error: unknown): Response | null {
  if (error instanceof RevisionAccessError) {
    return error.reason === 'unauthenticated'
      ? jsonError(401, 'unauthorized', 'Authentication is required')
      : jsonError(403, 'forbidden', 'You do not have permission to perform this action');
  }
  if (error instanceof RevisionCommandError) {
    return jsonError(400, 'invalid_request', 'Revision command is invalid');
  }
  if (error instanceof RevisionPersistenceError) {
    return jsonError(500, 'persistence_failed', 'Revision persistence failed');
  }
  return null;
}

export function revisionResultErrorResponse(error: RevisionError): Response {
  switch (error.kind) {
    case 'revision_conflict':
      return jsonError(409, error.kind, 'Content changed since it was loaded');
    case 'revision_not_found':
      return jsonError(404, error.kind, 'Revision was not found');
    case 'aggregate_not_found':
      return jsonError(404, error.kind, 'Content was not found');
    case 'invalid_transition':
      return jsonError(409, error.kind, 'Revision state does not allow this action');
    case 'snapshot_invalid':
      return jsonError(422, error.kind, 'Revision content is invalid');
    default:
      return assertNever(error);
  }
}

const assertNever = (value: never): never => {
  void value;
  throw new RevisionCommandError();
};

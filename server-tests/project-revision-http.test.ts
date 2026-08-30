import { describe, expect, it } from 'vitest';
import { seedProjects } from '../src/data/projects';
import type { Project } from '../src/lib/project-types';
import { buildProjectRevisionTransport } from '../src/lib/server/project-revision-adapter';
import {
  deleteProjectMutationSchema,
  deriveProjectRevisionTimestamps,
  projectOwnerSaveSchema,
  revisionExceptionResponse,
  revisionResultErrorResponse,
} from '../src/lib/server/project-revision-http';
import { projectSnapshotSchema, type ProjectSnapshot, type RevisionError } from '../src/lib/server/revision-contracts';
import {
  RevisionAccessError,
  RevisionCommandError,
  RevisionPersistenceError,
} from '../src/lib/server/revisions';
import { parseProjectRevisionMetadataRows } from '../src/lib/server/project-revision-store';

const revisionId = '11111111-1111-4111-8111-111111111111';
const mutationTime = '2026-08-30T09:10:11.000Z';

function projectFixture(status: Project['status'] = 'draft'): Project {
  const seed = seedProjects[0];
  if (!seed) throw new Error('Project seed fixture is required');
  return {
    ...structuredClone(seed),
    id: 'transport-project',
    status,
    cardImages: [{ id: 'existing-image', url: '/media/existing.webp', alt: 'Existing', role: 'card', sortOrder: 0 }],
    gallery: [{ id: 'new-image', url: '/media/new.webp', alt: 'New', role: 'gallery', sortOrder: 0 }],
    updatedAt: '1999-01-01T00:00:00.000Z',
  };
}

function currentSnapshot(publishedAt: string | null = null): ProjectSnapshot {
  const project = projectFixture();
  const snapshot = buildProjectRevisionTransport({
    project: { ...project, updatedAt: '2025-01-02T03:04:05.000Z' },
    timestamps: {
      createdAt: '2020-01-02T03:04:05.000Z',
      publishedAt,
      imageCreatedAt: {
        'existing-image': '2021-02-03T04:05:06.000Z',
        'new-image': '2021-02-03T04:05:06.000Z',
      },
    },
    expectedRevisionId: revisionId,
    mediaFileIds: [],
  }).snapshot;
  return projectSnapshotSchema.parse({
    ...snapshot,
    images: snapshot.images.filter((image) => image.id === 'existing-image'),
  });
}

describe('project revision HTTP boundary', () => {
  it('parses explicit owner save and delete transports without an intent field', () => {
    // Given
    const project = projectFixture();

    // When
    const save = projectOwnerSaveSchema.safeParse({ project, expectedRevisionId: revisionId, mediaFileIds: ['media-a'] });
    const deletion = deleteProjectMutationSchema.safeParse({ expectedCurrentRevisionId: revisionId });

    // Then
    expect(save.success).toBe(true);
    expect(deletion.success).toBe(true);
    expect(projectOwnerSaveSchema.safeParse({ project, expectedRevisionId: revisionId, mediaFileIds: [], intent: 'draft' }).success).toBe(false);
  });

  it('parses only non-sensitive current revision media transport fields', () => {
    // Given
    const rows = [{
      aggregate_id: 'transport-project',
      current_revision_id: revisionId,
      managed_media: [{
        id: 'media-a', relativeUrl: '/media/a.webp', relativePath: 'a.webp',
      }],
    }];

    // When
    const metadata = parseProjectRevisionMetadataRows(rows).get('transport-project');

    // Then
    expect(metadata).toEqual({
      currentRevisionId: revisionId,
      managedMedia: [{ id: 'media-a', relativeUrl: '/media/a.webp', relativePath: 'a.webp' }],
    });
    expect(JSON.stringify(metadata)).not.toContain('snapshot');
    expect(JSON.stringify(metadata)).not.toContain('session');
  });

  it('derives canonical timestamps from the expected head and one server time', () => {
    // Given
    const project = projectFixture('published');

    // When
    const timestamps = deriveProjectRevisionTimestamps(project, currentSnapshot(), mutationTime);

    // Then
    expect(timestamps).toEqual({
      createdAt: '2020-01-02T03:04:05.000Z',
      publishedAt: mutationTime,
      imageCreatedAt: { 'existing-image': '2021-02-03T04:05:06.000Z', 'new-image': mutationTime },
    });
  });

  it('preserves the first publication timestamp after unpublishing', () => {
    // Given
    const publishedAt = '2022-03-04T05:06:07.000Z';

    // When
    const timestamps = deriveProjectRevisionTimestamps(projectFixture('draft'), currentSnapshot(publishedAt), mutationTime);

    // Then
    expect(timestamps.publishedAt).toBe(publishedAt);
  });

  it.each([
    [new RevisionAccessError('unauthenticated'), 401, 'unauthorized'],
    [new RevisionAccessError('forbidden'), 403, 'forbidden'],
    [new RevisionCommandError(), 400, 'invalid_request'],
    [new RevisionPersistenceError(), 500, 'persistence_failed'],
  ])('maps revision exception %s to a stable response', async (error, status, code) => {
    // Given / When
    const response = revisionExceptionResponse(error);

    // Then
    expect(response?.status).toBe(status);
    expect(await response?.json()).toMatchObject({ error: { code } });
  });

  it.each<[RevisionError, number]>([
    [{ kind: 'revision_conflict', expectedRevisionId: revisionId, currentRevisionId: null }, 409],
    [{ kind: 'revision_not_found', revisionId }, 404],
    [{ kind: 'aggregate_not_found', aggregateType: 'project', aggregateId: 'missing' }, 404],
    [{ kind: 'invalid_transition', revisionId, state: 'approved' }, 409],
    [{ kind: 'snapshot_invalid', aggregateType: 'project', aggregateId: 'invalid' }, 422],
  ])('maps revision result error $kind to a stable response', async (error, status) => {
    // Given / When
    const response = revisionResultErrorResponse(error);

    // Then
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code: error.kind } });
  });
});

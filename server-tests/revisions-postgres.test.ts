import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../scripts/postgres-migrate.mjs';
import { seedProjects } from '../src/data/projects';
import { sha256 } from '../src/lib/server/auth/crypto';
import { createSession, type IssuedSession } from '../src/lib/server/auth/session';
import { hashPassword } from '../src/lib/server/auth/password';
import type { Project } from '../src/lib/project-types';
import { projectSnapshotSchema, revisionActionInputSchema, type ProjectSnapshot } from '../src/lib/server/revision-contracts';
import { RevisionService } from '../src/lib/server/revisions';
import { parseStoredSnapshot } from '../src/lib/server/revision-materializers';
import { saveProject } from '../src/lib/server/projects';

const databaseUrl = requireSafeDatabaseUrl();
const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
const projectId = 'revision-acceptance-project';
const mediaId = 'revision-acceptance-media';
let ownerSession: IssuedSession;
let editorSession: IssuedSession;
let baselineSnapshot: ProjectSnapshot;
let baselineRevisionId: string;

beforeAll(async () => {
  await pool.query('drop schema if exists miracon cascade; drop schema if exists miracon_meta cascade');
  await migrate(databaseUrl);
  const passwordHash = await hashPassword('revision acceptance password');
  await pool.query(`insert into miracon.admin_users (id, email, password_hash, role)
    values (1, 'revision-owner@miracon.local', $1, 'owner')`, [passwordHash]);
  const editor = await pool.query<{ readonly id: number }>(`insert into miracon.admin_users (email, password_hash, role)
    values ('revision-editor@miracon.local', $1, 'editor') returning id`, [passwordHash]);
  const editorId = editor.rows[0]?.id;
  if (!editorId) throw new Error('Editor fixture was not created');
  const now = new Date();
  ownerSession = await createSession(pool, 1, { now, ttlMs: 3_600_000 });
  editorSession = await createSession(pool, editorId, { now, ttlMs: 3_600_000 });
  await pool.query(`insert into miracon.media_files
    (id, relative_url, relative_path, mime_type, size_bytes, sha256, uploaded_by)
    values ($1, '/media/revisions/acceptance.webp', 'revisions/acceptance.webp', 'image/webp', 100, $2, 1)`, [mediaId, sha256('revision-media')]);
  await saveProject(pool, projectFixture());
  baselineSnapshot = await loadProjectSnapshot();
  const baseline = await pool.query<{ readonly id: string }>(`insert into miracon.content_revisions
    (aggregate_type, aggregate_id, revision_number, state, action, snapshot, approved_at)
    values ('project', $1, 1, 'approved', 'baseline', $2::jsonb, clock_timestamp()) returning id`, [projectId, JSON.stringify(baselineSnapshot)]);
  const id = baseline.rows[0]?.id;
  if (!id) throw new Error('Baseline fixture was not created');
  baselineRevisionId = id;
  await pool.query(`insert into miracon.content_revision_heads
    (aggregate_type, aggregate_id, current_revision_id, current_revision_number)
    values ('project', $1, $2, 1)`, [projectId, baselineRevisionId]);
}, 30_000);

afterAll(async () => {
  await pool.end();
});

describe('PostgreSQL revision service', () => {
  it('proposes, approves, rejects, rolls back, deletes, restores, and records immutable evidence', async () => {
    // Given
    const service = new RevisionService(pool);
    const approvedSnapshot = exactProjectSnapshot('Approved title');

    // When
    const proposal = await service.execute(editorSession.sessionToken, {
      action: 'proposal', aggregateType: 'project', aggregateId: projectId, snapshot: approvedSnapshot,
      expectedRevisionId: baselineRevisionId, mediaFileIds: [mediaId],
    });

    // Then
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) throw new Error('Proposal failed');
    expect(await liveTitle()).toBe('Revision baseline');
    expect(await currentHead()).toBe(baselineRevisionId);

    // When
    const approval = await service.execute(ownerSession.sessionToken, {
      action: 'approve', revisionId: proposal.value.id, expectedCurrentRevisionId: baselineRevisionId,
    });

    // Then
    expect(approval.ok).toBe(true);
    expect(await liveTitle()).toBe('Approved title');
    expect(await currentHead()).toBe(proposal.value.id);
    expect(await loadProjectSnapshot()).toEqual(approvedSnapshot);
    expect(await projectHeadSnapshot()).toEqual(approvedSnapshot);
    expect(await auditAfterSnapshot(proposal.value.id, 'approve')).toEqual(approvedSnapshot);

    // When
    const rejectedProposal = await service.execute(editorSession.sessionToken, {
      action: 'proposal', aggregateType: 'project', aggregateId: projectId, snapshot: changedSnapshot('Rejected title'),
      expectedRevisionId: proposal.value.id, mediaFileIds: [],
    });
    if (!rejectedProposal.ok) throw new Error('Rejected proposal setup failed');
    const rejection = await service.execute(ownerSession.sessionToken, {
      action: 'reject', revisionId: rejectedProposal.value.id, expectedCurrentRevisionId: proposal.value.id,
    });

    // Then
    expect(rejection.ok).toBe(true);
    expect(await liveTitle()).toBe('Approved title');
    expect(await currentHead()).toBe(proposal.value.id);

    // When
    const rollback = await service.execute(ownerSession.sessionToken, {
      action: 'rollback', targetRevisionId: baselineRevisionId, expectedCurrentRevisionId: proposal.value.id,
    });
    if (!rollback.ok) throw new Error('Rollback failed');
    const deletion = await service.execute(ownerSession.sessionToken, {
      action: 'delete', aggregateType: 'project', aggregateId: projectId, expectedCurrentRevisionId: rollback.value.id,
    });
    if (!deletion.ok) throw new Error('Delete failed');
    const restore = await service.execute(ownerSession.sessionToken, {
      action: 'rollback', targetRevisionId: proposal.value.id, expectedCurrentRevisionId: deletion.value.id,
    });

    // Then
    expect(restore.ok).toBe(true);
    expect(await liveTitle()).toBe('Approved title');
    expect(await loadProjectSnapshot()).toEqual(approvedSnapshot);
    const evidence = await pool.query(`select
      (select array_agg(revision_number order by revision_number) from miracon.content_revisions where aggregate_id = $1) as numbers,
      (select array_agg(action::text order by created_at, id) from miracon.audit_events where aggregate_id = $1) as actions,
      (select count(*)::integer from miracon.revision_media where media_file_id = $2) as media_count`, [projectId, mediaId]);
    expect(evidence.rows[0].numbers).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(evidence.rows[0].actions).toEqual(['proposal', 'approve', 'proposal', 'reject', 'rollback', 'delete', 'rollback']);
    expect(evidence.rows[0].media_count).toBe(2);
  });

  it('serializes concurrent commands so only one stale-head contender wins', async () => {
    // Given
    const service = new RevisionService(pool);
    const expectedRevisionId = await currentHead();
    const command = { action: 'publish' as const, aggregateType: 'project' as const, aggregateId: projectId, snapshot: changedSnapshot('Concurrent winner'), expectedRevisionId, mediaFileIds: [], confirmPublish: true as const };
    const before = await revisionEvidenceCounts();

    // When
    const results = await Promise.all([service.execute(ownerSession.sessionToken, command), service.execute(ownerSession.sessionToken, command)]);

    // Then
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.error.kind === 'revision_conflict')).toHaveLength(1);
    const winner = results.find((result) => result.ok);
    if (!winner?.ok) throw new Error('Concurrent winner was not returned');
    expect(await revisionEvidenceCounts()).toEqual({ revisions: before.revisions + 1, audits: before.audits + 1 });
    expect(await projectHeadSnapshot()).toEqual(command.snapshot);
    expect(await auditAfterSnapshot(winner.value.id, 'publish')).toEqual(command.snapshot);
  });

  it('rolls back revision and audit writes when a media reference is invalid', async () => {
    // Given
    const service = new RevisionService(pool);
    const expectedRevisionId = await currentHead();
    const beforeTitle = await liveTitle();
    const before = await pool.query(`select
      (select count(*)::integer from miracon.content_revisions where aggregate_id = $1) as revisions,
      (select count(*)::integer from miracon.audit_events where aggregate_id = $1) as audits`, [projectId]);

    // When
    const result = await service.execute(editorSession.sessionToken, {
      action: 'proposal', aggregateType: 'project', aggregateId: projectId,
      snapshot: changedSnapshot('Must roll back'), expectedRevisionId, mediaFileIds: ['missing-media'],
    });

    // Then
    expect(result).toEqual({ ok: false, error: { kind: 'snapshot_invalid', aggregateType: 'project', aggregateId: projectId } });
    const after = await pool.query(`select
      (select count(*)::integer from miracon.content_revisions where aggregate_id = $1) as revisions,
      (select count(*)::integer from miracon.audit_events where aggregate_id = $1) as audits`, [projectId]);
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(await currentHead()).toBe(expectedRevisionId);
    expect(await liveTitle()).toBe(beforeTitle);
  });

  it('publishes complete homepage and settings snapshots through their canonical materializers', async () => {
    // Given
    const service = new RevisionService(pool);
    const homepageHead = await singletonHead('homepage_hero');
    const settingsHead = await singletonHead('site_settings');
    const homepageCreatedAt = '2004-05-06T07:08:09.000Z';
    const homepageUpdatedAt = '2005-06-07T08:09:10.000Z';
    const settingsUpdatedAt = '2006-07-08T09:10:11.000Z';

    // When
    const homepageCommand = revisionActionInputSchema.parse({
      action: 'publish', aggregateType: 'homepage_hero', aggregateId: 'singleton', expectedRevisionId: homepageHead,
      confirmPublish: true, mediaFileIds: [],
      snapshot: { aggregateType: 'homepage_hero', aggregateId: 'singleton', videos: [{
        id: 'revision-homepage-video', title: 'Revision video', project_id: null,
        desktop_url: '/media/revisions/video.mp4', desktop_storage_path: null, mobile_url: null,
        mobile_storage_path: null, sort_order: 0, is_active: true, created_at: homepageCreatedAt, updated_at: homepageUpdatedAt,
      }] },
    });
    const homepage = await service.execute(ownerSession.sessionToken, homepageCommand);
    const settings = await service.execute(ownerSession.sessionToken, {
      action: 'publish', aggregateType: 'site_settings', aggregateId: 'singleton', expectedRevisionId: settingsHead,
      confirmPublish: true, mediaFileIds: [],
      snapshot: { aggregateType: 'site_settings', aggregateId: 'singleton', settings: {
        id: 1, footer_terms_visible: true, footer_terms_pdf_url: '/media/legal/terms.pdf',
        footer_privacy_visible: false, footer_privacy_pdf_url: '', footer_cookie_visible: false,
        footer_cookie_pdf_url: '', updated_at: settingsUpdatedAt,
      } },
    });

    // Then
    expect(homepage.ok).toBe(true);
    expect(settings.ok).toBe(true);
    const live = await pool.query(`select
      (select array_agg(id order by sort_order) from miracon.homepage_videos) as videos,
      (select footer_terms_pdf_url from miracon.site_settings where id = 1) as terms_url`);
    expect(live.rows[0]).toMatchObject({ videos: ['revision-homepage-video'], terms_url: '/media/legal/terms.pdf' });
    expect(await singletonLiveSnapshot('homepage_hero')).toEqual(homepageCommand.snapshot);
    expect(await singletonLiveSnapshot('site_settings')).toEqual(settings.value.snapshot);
  });

  it('rolls back materialization when canonical image ordering differs from the revision snapshot', async () => {
    // Given
    const service = new RevisionService(pool);
    const expectedRevisionId = await currentHead();
    const sourceImage = baselineSnapshot.images[0];
    if (!sourceImage) throw new Error('Project image fixture is required');
    const snapshot = projectSnapshotSchema.parse({
      ...changedSnapshot('Ordering mismatch'),
      images: [
        { ...sourceImage, id: 'revision-mismatch-z', sort_order: 2 },
        { ...sourceImage, id: 'revision-mismatch-a', sort_order: 1 },
      ],
    });
    const before = await revisionEvidenceCounts();
    const beforeLive = await loadProjectSnapshot();

    // When
    const result = await service.execute(ownerSession.sessionToken, {
      action: 'publish', aggregateType: 'project', aggregateId: projectId, snapshot,
      expectedRevisionId, mediaFileIds: [], confirmPublish: true,
    });

    // Then
    expect(result).toEqual({ ok: false, error: { kind: 'snapshot_invalid', aggregateType: 'project', aggregateId: projectId } });
    expect(await revisionEvidenceCounts()).toEqual(before);
    expect(await currentHead()).toBe(expectedRevisionId);
    expect(await loadProjectSnapshot()).toEqual(beforeLive);
  });

  it('rejects project deletion while the homepage references that project', async () => {
    // Given
    const service = new RevisionService(pool);
    const homepageHead = await singletonHead('homepage_hero');
    const homepage = await service.execute(ownerSession.sessionToken, {
      action: 'publish', aggregateType: 'homepage_hero', aggregateId: 'singleton', expectedRevisionId: homepageHead,
      confirmPublish: true, mediaFileIds: [], snapshot: {
        aggregateType: 'homepage_hero', aggregateId: 'singleton', videos: [{
          id: 'revision-project-reference', title: 'Referenced project', project_id: projectId,
          desktop_url: '/img/reference.mp4', desktop_storage_path: null, mobile_url: null,
          mobile_storage_path: null, sort_order: 0, is_active: true,
          created_at: '2007-08-09T10:11:12.000Z', updated_at: '2008-09-10T11:12:13.000Z',
        }],
      },
    });
    if (!homepage.ok) throw new Error('Homepage reference fixture failed');
    const projectHead = await currentHead();
    const before = await revisionEvidenceCounts();

    // When
    const result = await service.execute(ownerSession.sessionToken, {
      action: 'delete', aggregateType: 'project', aggregateId: projectId, expectedCurrentRevisionId: projectHead,
    });

    // Then
    expect(result).toEqual({ ok: false, error: { kind: 'snapshot_invalid', aggregateType: 'project', aggregateId: projectId } });
    expect(await revisionEvidenceCounts()).toEqual(before);
    expect(await currentHead()).toBe(projectHead);
    expect(await liveTitle()).not.toBeNull();
    const reference = await pool.query('select project_id from miracon.homepage_videos where id = $1', ['revision-project-reference']);
    expect(reference.rows[0]?.project_id).toBe(projectId);
  });
});

function changedSnapshot(title: string): ProjectSnapshot {
  if (!baselineSnapshot.project) throw new Error('Active project snapshot required');
  return projectSnapshotSchema.parse({
    ...baselineSnapshot,
    project: { ...baselineSnapshot.project, title, updated_at: new Date().toISOString() },
  });
}

function exactProjectSnapshot(title: string): ProjectSnapshot {
  if (!baselineSnapshot.project) throw new Error('Active project snapshot required');
  return projectSnapshotSchema.parse({
    ...baselineSnapshot,
    project: {
      ...baselineSnapshot.project,
      title,
      translations: { el: { title: 'Ακριβής τίτλος' } },
      created_at: '2001-02-03T04:05:06.000Z',
      updated_at: '2002-03-04T05:06:07.000Z',
    },
    images: baselineSnapshot.images.map((image) => ({ ...image, created_at: '2003-04-05T06:07:08.000Z' })),
  });
}

async function loadProjectSnapshot(): Promise<ProjectSnapshot> {
  const result = await pool.query<{ readonly snapshot: unknown }>(`select jsonb_build_object(
    'aggregateType', 'project', 'aggregateId', project.id, 'deleted', false,
    'project', to_jsonb(project), 'images', coalesce((select jsonb_agg(to_jsonb(image) order by image.role, image.sort_order, image.id) from miracon.project_images as image where image.project_id = project.id), '[]'::jsonb)
  ) as snapshot from miracon.projects as project where project.id = $1`, [projectId]);
  const snapshot = parseStoredSnapshot(result.rows[0]?.snapshot);
  return projectSnapshotSchema.parse(snapshot);
}

async function currentHead(): Promise<string> {
  const result = await pool.query(`select current_revision_id from miracon.content_revision_heads where aggregate_type = 'project' and aggregate_id = $1`, [projectId]);
  return String(result.rows[0]?.current_revision_id);
}

async function projectHeadSnapshot(): Promise<ProjectSnapshot> {
  const result = await pool.query(`select revision.snapshot from miracon.content_revision_heads as head
    join miracon.content_revisions as revision on revision.id = head.current_revision_id
    where head.aggregate_type = 'project' and head.aggregate_id = $1`, [projectId]);
  return projectSnapshotSchema.parse(parseStoredSnapshot(result.rows[0]?.snapshot));
}

async function auditAfterSnapshot(revisionId: string, action: string): Promise<ProjectSnapshot> {
  const result = await pool.query('select after_snapshot from miracon.audit_events where revision_id = $1 and action = $2', [revisionId, action]);
  return projectSnapshotSchema.parse(parseStoredSnapshot(result.rows[0]?.after_snapshot));
}

async function revisionEvidenceCounts(): Promise<{ readonly revisions: number; readonly audits: number }> {
  const result = await pool.query(`select
    (select count(*)::integer from miracon.content_revisions where aggregate_type = 'project' and aggregate_id = $1) as revisions,
    (select count(*)::integer from miracon.audit_events where aggregate_type = 'project' and aggregate_id = $1) as audits`, [projectId]);
  return { revisions: Number(result.rows[0]?.revisions), audits: Number(result.rows[0]?.audits) };
}

async function singletonHead(aggregateType: 'homepage_hero' | 'site_settings'): Promise<string> {
  const result = await pool.query(`select current_revision_id from miracon.content_revision_heads
    where aggregate_type = $1 and aggregate_id = 'singleton'`, [aggregateType]);
  return String(result.rows[0]?.current_revision_id);
}

async function singletonLiveSnapshot(aggregateType: 'homepage_hero' | 'site_settings'): Promise<unknown> {
  if (aggregateType === 'homepage_hero') {
    const result = await pool.query(`select jsonb_build_object(
      'aggregateType', 'homepage_hero', 'aggregateId', 'singleton',
      'videos', coalesce(jsonb_agg(to_jsonb(video) order by video.sort_order, video.id) filter (where video.id is not null), '[]'::jsonb)
    ) as snapshot from (select 1) as singleton left join miracon.homepage_videos as video on true`);
    return parseStoredSnapshot(result.rows[0]?.snapshot);
  }
  const result = await pool.query(`select jsonb_build_object(
    'aggregateType', 'site_settings', 'aggregateId', 'singleton', 'settings', to_jsonb(settings)
  ) as snapshot from miracon.site_settings as settings where id = 1`);
  return parseStoredSnapshot(result.rows[0]?.snapshot);
}

async function liveTitle(): Promise<string | null> {
  const result = await pool.query('select title from miracon.projects where id = $1', [projectId]);
  return result.rows[0] ? String(result.rows[0].title) : null;
}

function projectFixture(): Project {
  const source = seedProjects[0];
  if (!source) throw new Error('Project fixture source is required');
  return { ...structuredClone(source), id: projectId, slug: projectId, title: 'Revision baseline', status: 'draft', sortOrder: 0 };
}

function requireSafeDatabaseUrl(): string {
  const value = process.env.DATABASE_TEST_URL;
  if (!value || process.env.DATABASE_TEST_ALLOW_RESET !== '1' || !/(?:^|[_-])(?:test|testing|ci|disposable|tmp)(?:$|[_-])/iu.test(new URL(value).pathname)) {
    throw new Error('Guarded DATABASE_TEST_URL and DATABASE_TEST_ALLOW_RESET=1 are required');
  }
  return value;
}

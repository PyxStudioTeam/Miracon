import { describe, expect, it } from 'vitest';
import {
  CONTENT_AGGREGATE_TYPES,
  CONTENT_AUDIT_ACTIONS,
  CONTENT_REVISION_ACTIONS,
  CONTENT_REVISION_STATES,
  type CanonicalProjectRow,
  type ProjectSnapshot,
  type RevisionRecord,
  approveRevisionInputSchema,
  canonicalProjectRowSchema,
  contentAggregateTypeSchema,
  contentAuditActionSchema,
  contentRevisionActionSchema,
  contentRevisionStateSchema,
  contentSnapshotSchema,
  createProposalInputSchema,
  deleteProjectInputSchema,
  homepageHeroSnapshotSchema,
  projectSnapshotSchema,
  publishOwnRevisionInputSchema,
  rejectRevisionInputSchema,
  revisionActionInputSchema,
  revisionHeadSchema,
  revisionIdSchema,
  revisionRecordSchema,
  rollbackRevisionInputSchema,
  siteSettingsSnapshotSchema,
} from '../src/lib/server/revision-contracts';

const revisionId = '4c4e0a24-0e6a-4f37-91f0-813768e0a7da';
const nextRevisionId = '2d57a00e-4240-419a-8cbe-40fd4b2bfb3d';
const deterministicBaselineId = 'b82b7365-586a-c0b2-208c-0a3c2ed91401';

const project = (overrides: Partial<CanonicalProjectRow> = {}): CanonicalProjectRow => ({
  id: 'project-1', slug: 'project-1', title: 'Project', address: 'Address', card_address: 'Card address', price: 'Price',
  short_description: 'Short', full_description: 'Full', intro_title: 'Intro', categories: [], status: 'draft', sort_order: 0,
  cover_url: '', cover_focal_x: 50, cover_focal_y: 50, image_variants: {}, hero_type: 'image', hero_variant: 'standard',
  hero_sound_enabled: false, hero_idle_ui: false, hero_url: '', hero_mobile_url: null, hero_poster_url: null, hero_videos: [],
  walkthrough_video_enabled: false, walkthrough_video_title: 'Walkthrough', walkthrough_video_desktop_url: '',
  walkthrough_video_mobile_url: null, walkthrough_video_poster_url: null, walkthrough_videos: [], hero_focal_x: 50,
  hero_focal_y: 50, intro_image_url: '', brochure_url: null, map_query: '', map_url: '', characteristics: [], benefits: [],
  floor_plan_groups: [], nearby_places: [], translations: {}, seo_title: '', seo_description: '', published_at: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', remaining_units: null,
  ...overrides,
});

const projectSnapshot = (overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot => ({
  aggregateType: 'project' as const,
  aggregateId: 'project-1',
  deleted: false,
  project: project(),
  images: [{ id: 'image-1', project_id: 'project-1', url: '/media/image.jpg', storage_path: null, alt: '', role: 'gallery' as const, sort_order: 0, width: null, height: null, focal_x: 50, focal_y: 50, created_at: '2026-01-01T00:00:00Z' }],
  ...overrides,
});

const homepageSnapshot = () => ({
  aggregateType: 'homepage_hero' as const, aggregateId: 'singleton',
  videos: [{ id: 'video-1', title: 'Video', project_id: null, desktop_url: '/media/video.mp4', desktop_storage_path: null, mobile_url: null, mobile_storage_path: null, sort_order: 0, is_active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }],
});

const settingsSnapshot = () => ({
  aggregateType: 'site_settings' as const, aggregateId: 'singleton',
  settings: { id: 1 as const, footer_terms_visible: true, footer_terms_pdf_url: '', footer_privacy_visible: false, footer_privacy_pdf_url: '', footer_cookie_visible: false, footer_cookie_pdf_url: '', updated_at: '2026-01-01T00:00:00Z' },
});

const revision = (overrides: Partial<RevisionRecord> = {}): RevisionRecord => ({
  id: revisionId, aggregateType: 'project', aggregateId: 'project-1', revisionNumber: 1, state: 'approved', action: 'baseline',
  snapshot: projectSnapshot(), expectedRevisionId: null, createdBy: null, approvedBy: null,
  createdAt: '2026-01-01T00:00:00Z', approvedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const proposalInput = () => ({
  aggregateType: 'project' as const, aggregateId: 'project-1', snapshot: projectSnapshot(),
  expectedRevisionId: null, mediaFileIds: ['media-1'],
});

describe('revision contracts', () => {
  it('exposes every migration enum literal and rejects unknown values', () => {
    // Given
    const aggregateTypes = ['project', 'homepage_hero', 'site_settings'];
    const states = ['pending', 'approved', 'rejected'];
    const actions = ['baseline', 'proposal', 'publish', 'rollback', 'delete'];
    const auditActions = ['proposal', 'publish', 'approve', 'reject', 'rollback', 'delete'];
    // When
    const unknownValues = [contentAggregateTypeSchema.safeParse('unknown'), contentRevisionStateSchema.safeParse('unknown'), contentRevisionActionSchema.safeParse('unknown'), contentAuditActionSchema.safeParse('unknown')];
    // Then
    expect(CONTENT_AGGREGATE_TYPES).toEqual(aggregateTypes);
    expect(CONTENT_REVISION_STATES).toEqual(states);
    expect(CONTENT_REVISION_ACTIONS).toEqual(actions);
    expect(CONTENT_AUDIT_ACTIONS).toEqual(auditActions);
    expect(unknownValues.every((result) => !result.success)).toBe(true);
  });

  it('accepts complete project, homepage, and settings snapshots', () => {
    // Given
    const activeProject = projectSnapshot();
    const homepage = homepageSnapshot();
    const settings = settingsSnapshot();
    // When
    const parsed = [projectSnapshotSchema.safeParse(activeProject), homepageHeroSnapshotSchema.safeParse(homepage), siteSettingsSnapshotSchema.safeParse(settings), contentSnapshotSchema.safeParse(settings)];
    // Then
    expect(parsed.every((result) => result.success)).toBe(true);
  });

  it('accepts a deleted project only when its content is absent', () => {
    // Given
    const deleted = { aggregateType: 'project' as const, aggregateId: 'project-1', deleted: true, project: null, images: [] };
    // When
    const parsed = projectSnapshotSchema.safeParse(deleted);
    // Then
    expect(parsed.success).toBe(true);
  });

  it('rejects unknown or missing snapshot keys at every governed level', () => {
    // Given
    const active = projectSnapshot();
    const { images: ignoredImages, ...withoutImages } = active;
    const { updated_at: ignoredUpdatedAt, ...withoutUpdatedAt } = project();
    // When
    const results = [
      projectSnapshotSchema.safeParse({ ...active, extra: true }),
      projectSnapshotSchema.safeParse(withoutImages),
      projectSnapshotSchema.safeParse({ ...active, project: { ...project(), extra: true } }),
      projectSnapshotSchema.safeParse({ ...active, project: withoutUpdatedAt }),
      projectSnapshotSchema.safeParse({ ...active, images: [{ ...active.images[0], extra: true }] }),
      homepageHeroSnapshotSchema.safeParse({ ...homepageSnapshot(), videos: [{ ...homepageSnapshot().videos[0], extra: true }] }),
      siteSettingsSnapshotSchema.safeParse({ ...settingsSnapshot(), settings: { ...settingsSnapshot().settings, extra: true } }),
    ];
    // Then
    expect(results.every((result) => !result.success)).toBe(true);
  });

  it('rejects project identities, deletion invariants, singleton identities, and invalid scalar values', () => {
    // Given
    const active = projectSnapshot();
    // When
    const results = [
      projectSnapshotSchema.safeParse({ ...active, aggregateId: 'other' }),
      projectSnapshotSchema.safeParse({ ...active, project: project({ id: 'other' }) }),
      projectSnapshotSchema.safeParse({ ...active, images: [{ ...active.images[0], project_id: 'other' }] }),
      projectSnapshotSchema.safeParse({ ...active, images: [{ ...active.images[0], role: 'unknown' }] }),
      projectSnapshotSchema.safeParse({ ...active, deleted: true }),
      projectSnapshotSchema.safeParse({ ...active, deleted: true, project: null }),
      homepageHeroSnapshotSchema.safeParse({ ...homepageSnapshot(), aggregateId: 'other' }),
      homepageHeroSnapshotSchema.safeParse({ ...homepageSnapshot(), videos: [{ ...homepageSnapshot().videos[0], is_active: 'true' }] }),
      siteSettingsSnapshotSchema.safeParse({ ...settingsSnapshot(), aggregateId: 'other' }),
      canonicalProjectRowSchema.safeParse(project({ remaining_units: -1 })),
      canonicalProjectRowSchema.safeParse(project({ remaining_units: 1.5 })),
      canonicalProjectRowSchema.safeParse(({ ...project(), remaining_units: undefined })),
      canonicalProjectRowSchema.safeParse(project({ created_at: 'not-a-date' })),
      canonicalProjectRowSchema.safeParse({ ...project(), hero_type: 'audio' }),
    ];
    // Then
    expect(results.every((result) => !result.success)).toBe(true);
  });

  it('accepts only rows that satisfy migration revision metadata', () => {
    // Given
    const proposal = revision({ id: nextRevisionId, revisionNumber: 2, action: 'proposal', state: 'pending', expectedRevisionId: revisionId, createdBy: 2, approvedBy: null, approvedAt: null });
    const approvedProposal = revision({ id: nextRevisionId, revisionNumber: 2, action: 'proposal', state: 'approved', expectedRevisionId: revisionId, createdBy: 2, approvedBy: 1, approvedAt: '2026-01-02T00:00:00Z' });
    const rejectedProposal = revision({ id: nextRevisionId, revisionNumber: 2, action: 'proposal', state: 'rejected', expectedRevisionId: revisionId, createdBy: 2, approvedBy: null, approvedAt: null });
    const published = revision({ id: nextRevisionId, revisionNumber: 2, action: 'publish', state: 'approved', expectedRevisionId: revisionId, createdBy: 2, approvedBy: 1, approvedAt: '2026-01-02T00:00:00Z' });
    const rollback = revision({ id: nextRevisionId, revisionNumber: 2, action: 'rollback', state: 'approved', expectedRevisionId: revisionId, createdBy: 2, approvedBy: 1, approvedAt: '2026-01-02T00:00:00Z' });
    // When
    const parsed = [revisionRecordSchema.safeParse(revision()), revisionRecordSchema.safeParse(proposal), revisionRecordSchema.safeParse(approvedProposal), revisionRecordSchema.safeParse(rejectedProposal), revisionRecordSchema.safeParse(published), revisionRecordSchema.safeParse(rollback)];
    // Then
    expect(parsed.every((result) => result.success)).toBe(true);
  });

  it('rejects migration-invalid revision metadata and record identity mismatches', () => {
    // Given
    const valid = revision();
    // When
    const results = [
      revisionRecordSchema.safeParse({ ...valid, action: 'baseline', createdBy: 2 }),
      revisionRecordSchema.safeParse({ ...valid, revisionNumber: 2 }),
      revisionRecordSchema.safeParse({ ...valid, approvedAt: null }),
      revisionRecordSchema.safeParse({ ...valid, approvedBy: 1 }),
      revisionRecordSchema.safeParse({ ...valid, action: 'publish' }),
      revisionRecordSchema.safeParse({ ...valid, action: 'proposal', state: 'pending', createdBy: null, approvedAt: null }),
      revisionRecordSchema.safeParse({ ...valid, action: 'proposal', state: 'rejected', createdBy: 2, approvedBy: 1, approvedAt: null }),
      revisionRecordSchema.safeParse({ ...valid, action: 'proposal', state: 'approved', createdBy: 2, approvedBy: null }),
      revisionRecordSchema.safeParse({ ...valid, aggregateType: 'homepage_hero', aggregateId: 'other', snapshot: homepageSnapshot() }),
      revisionRecordSchema.safeParse({ ...valid, snapshot: { ...projectSnapshot(), aggregateId: 'other' } }),
      revisionRecordSchema.safeParse({ ...valid, extra: true }),
    ];
    // Then
    expect(results.every((result) => !result.success)).toBe(true);
  });

  it('requires governed heads to carry valid singleton and UUID identity', () => {
    // Given
    const head = { aggregateType: 'homepage_hero' as const, aggregateId: 'singleton', currentRevisionId: revisionId, currentRevisionNumber: 1 };
    // When
    const valid = revisionHeadSchema.safeParse(head);
    const invalid = [revisionHeadSchema.safeParse({ ...head, aggregateId: 'other' }), revisionHeadSchema.safeParse({ ...head, currentRevisionId: 'bad' }), revisionHeadSchema.safeParse({ ...head, extra: true })];
    // Then
    expect(valid.success).toBe(true);
    expect(invalid.every((result) => !result.success)).toBe(true);
  });

  it('keeps individual command schemas action-less and strict', () => {
    // Given
    const input = proposalInput();
    const publish = { ...input, confirmPublish: true as const };
    const approval = { revisionId, expectedCurrentRevisionId: null };
    const rollback = { targetRevisionId: revisionId, expectedCurrentRevisionId: nextRevisionId };
    const deletion = { aggregateType: 'project' as const, aggregateId: 'project-1', expectedCurrentRevisionId: revisionId };
    // When
    const valid = [createProposalInputSchema.safeParse(input), createProposalInputSchema.safeParse({ ...input, mediaFileIds: [] }), publishOwnRevisionInputSchema.safeParse(publish), approveRevisionInputSchema.safeParse(approval), rejectRevisionInputSchema.safeParse(approval), rollbackRevisionInputSchema.safeParse(rollback), deleteProjectInputSchema.safeParse(deletion)];
    const invalid = [
      createProposalInputSchema.safeParse(({ ...input, expectedRevisionId: undefined })),
      createProposalInputSchema.safeParse({ ...input, mediaFileIds: ['media-1', 'media-1'] }),
      createProposalInputSchema.safeParse({ ...input, mediaFileIds: [''] }),
      createProposalInputSchema.safeParse({ ...input, snapshot: { ...projectSnapshot(), aggregateId: 'other' } }),
      createProposalInputSchema.safeParse({ ...input, action: 'proposal' }),
      publishOwnRevisionInputSchema.safeParse(input),
      publishOwnRevisionInputSchema.safeParse({ ...publish, action: 'publish' }),
      approveRevisionInputSchema.safeParse({ ...approval, action: 'approve' }),
      rejectRevisionInputSchema.safeParse({ ...approval, action: 'reject' }),
      rollbackRevisionInputSchema.safeParse({ ...rollback, action: 'rollback' }),
      deleteProjectInputSchema.safeParse({ ...deletion, action: 'delete' }),
      deleteProjectInputSchema.safeParse({ ...deletion, aggregateType: 'homepage_hero' }),
      deleteProjectInputSchema.safeParse({ ...deletion, expectedCurrentRevisionId: null }),
      createProposalInputSchema.safeParse({ ...input, actorId: 2 }),
      approveRevisionInputSchema.safeParse({ ...approval, sessionId: 'session-1' }),
    ];
    // Then
    expect(valid.every((result) => result.success)).toBe(true);
    expect(invalid.every((result) => !result.success)).toBe(true);
  });

  it('routes action-tagged commands only through the strict action union', () => {
    // Given
    const input = proposalInput();
    const approval = { revisionId, expectedCurrentRevisionId: null };
    const rollback = { targetRevisionId: revisionId, expectedCurrentRevisionId: nextRevisionId };
    const deletion = { aggregateType: 'project' as const, aggregateId: 'project-1', expectedCurrentRevisionId: revisionId };
    // When
    const valid = [revisionActionInputSchema.safeParse({ ...input, action: 'proposal' }), revisionActionInputSchema.safeParse({ ...input, action: 'publish', confirmPublish: true }), revisionActionInputSchema.safeParse({ ...approval, action: 'approve' }), revisionActionInputSchema.safeParse({ ...approval, action: 'reject' }), revisionActionInputSchema.safeParse({ ...rollback, action: 'rollback' }), revisionActionInputSchema.safeParse({ ...deletion, action: 'delete' }), revisionIdSchema.safeParse(revisionId), revisionIdSchema.safeParse(deterministicBaselineId)];
    const invalid = [
      revisionActionInputSchema.safeParse({ ...approval, action: 'approve', extra: true }),
      revisionActionInputSchema.safeParse({ ...approval, action: 'reject', extra: true }),
      revisionActionInputSchema.safeParse({ ...rollback, action: 'rollback', extra: true }),
      revisionActionInputSchema.safeParse({ ...deletion, action: 'delete', extra: true }),
      revisionActionInputSchema.safeParse({ ...deletion, action: 'delete', actorId: 1 }),
      revisionActionInputSchema.safeParse({ ...input, action: 'unknown' }),
      revisionIdSchema.safeParse('bad'),
    ];
    // Then
    expect(valid.every((result) => result.success)).toBe(true);
    expect(invalid.every((result) => !result.success)).toBe(true);
  });
});

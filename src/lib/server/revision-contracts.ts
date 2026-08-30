import { z } from 'zod';

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[];

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema),
]));
const isoDateTimeSchema = z.iso.datetime();
const nonemptyStringSchema = z.string().min(1);
const positiveIntegerSchema = z.number().int().positive();
const nonnegativeIntegerSchema = z.number().int().min(0);
const postgresUuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);

export const CONTENT_AGGREGATE_TYPES = ['project', 'homepage_hero', 'site_settings'] as const;
export type ContentAggregateType = (typeof CONTENT_AGGREGATE_TYPES)[number];
export const contentAggregateTypeSchema = z.enum(CONTENT_AGGREGATE_TYPES);
export const SINGLETON_AGGREGATE_ID = 'singleton';
export const CONTENT_REVISION_STATES = ['pending', 'approved', 'rejected'] as const;
export type ContentRevisionState = (typeof CONTENT_REVISION_STATES)[number];
export const contentRevisionStateSchema = z.enum(CONTENT_REVISION_STATES);
export const CONTENT_REVISION_ACTIONS = ['baseline', 'proposal', 'publish', 'rollback', 'delete'] as const;
export type ContentRevisionAction = (typeof CONTENT_REVISION_ACTIONS)[number];
export const contentRevisionActionSchema = z.enum(CONTENT_REVISION_ACTIONS);
export const CONTENT_AUDIT_ACTIONS = ['proposal', 'publish', 'approve', 'reject', 'rollback', 'delete'] as const;
export type ContentAuditAction = (typeof CONTENT_AUDIT_ACTIONS)[number];
export const contentAuditActionSchema = z.enum(CONTENT_AUDIT_ACTIONS);

export const canonicalProjectRowSchema = z.object({
  id: nonemptyStringSchema, slug: z.string(), title: z.string(), address: z.string(), card_address: z.string(), price: z.string(),
  short_description: z.string(), full_description: z.string(), intro_title: z.string(), categories: z.array(z.string()), status: z.enum(['draft', 'published']), sort_order: nonnegativeIntegerSchema,
  cover_url: z.string(), cover_focal_x: z.number(), cover_focal_y: z.number(), image_variants: jsonValueSchema, hero_type: z.enum(['image', 'video']), hero_variant: z.enum(['standard', 'immersive']),
  hero_sound_enabled: z.boolean(), hero_idle_ui: z.boolean(), hero_url: z.string(), hero_mobile_url: z.string().nullable(), hero_poster_url: z.string().nullable(), hero_videos: jsonValueSchema,
  walkthrough_video_enabled: z.boolean(), walkthrough_video_title: z.string(), walkthrough_video_desktop_url: z.string(), walkthrough_video_mobile_url: z.string().nullable(), walkthrough_video_poster_url: z.string().nullable(), walkthrough_videos: jsonValueSchema,
  hero_focal_x: z.number(), hero_focal_y: z.number(), intro_image_url: z.string(), brochure_url: z.string().nullable(), map_query: z.string(), map_url: z.string(), characteristics: jsonValueSchema, benefits: jsonValueSchema,
  floor_plan_groups: jsonValueSchema, nearby_places: jsonValueSchema, translations: jsonValueSchema, seo_title: z.string(), seo_description: z.string(), published_at: isoDateTimeSchema.nullable(),
  created_at: isoDateTimeSchema, updated_at: isoDateTimeSchema, remaining_units: nonnegativeIntegerSchema.nullable(),
}).strict();
export type CanonicalProjectRow = z.infer<typeof canonicalProjectRowSchema>;

export const canonicalProjectImageRowSchema = z.object({
  id: nonemptyStringSchema, project_id: nonemptyStringSchema, url: z.string(), storage_path: z.string().nullable(), alt: z.string(), role: z.enum(['card', 'gallery']),
  sort_order: nonnegativeIntegerSchema, width: positiveIntegerSchema.nullable(), height: positiveIntegerSchema.nullable(), focal_x: z.number(), focal_y: z.number(), created_at: isoDateTimeSchema,
}).strict();
export type CanonicalProjectImageRow = z.infer<typeof canonicalProjectImageRowSchema>;

export const canonicalHomepageVideoRowSchema = z.object({
  id: nonemptyStringSchema, title: z.string(), project_id: nonemptyStringSchema.nullable(), desktop_url: z.string(), desktop_storage_path: z.string().nullable(), mobile_url: z.string().nullable(),
  mobile_storage_path: z.string().nullable(), sort_order: nonnegativeIntegerSchema, is_active: z.boolean(), created_at: isoDateTimeSchema, updated_at: isoDateTimeSchema,
}).strict();
export type CanonicalHomepageVideoRow = z.infer<typeof canonicalHomepageVideoRowSchema>;

export const canonicalSiteSettingsRowSchema = z.object({
  id: z.literal(1), footer_terms_visible: z.boolean(), footer_terms_pdf_url: z.string(), footer_privacy_visible: z.boolean(), footer_privacy_pdf_url: z.string(),
  footer_cookie_visible: z.boolean(), footer_cookie_pdf_url: z.string(), updated_at: isoDateTimeSchema,
}).strict();
export type CanonicalSiteSettingsRow = z.infer<typeof canonicalSiteSettingsRowSchema>;

const projectSnapshotBaseSchema = z.object({
  aggregateType: z.literal('project'), aggregateId: nonemptyStringSchema, deleted: z.boolean(), project: canonicalProjectRowSchema.nullable(), images: z.array(canonicalProjectImageRowSchema),
}).strict();
export const projectSnapshotSchema = projectSnapshotBaseSchema.superRefine((value, context) => {
  if (value.deleted && (value.project !== null || value.images.length !== 0)) context.addIssue({ code: 'custom', message: 'Deleted projects require null project and empty images' });
  if (!value.deleted && value.project === null) context.addIssue({ code: 'custom', message: 'Active projects require a project row' });
  if (value.project !== null && value.project.id !== value.aggregateId) context.addIssue({ code: 'custom', message: 'Project identity must match aggregate' });
  if (value.images.some((image) => image.project_id !== value.aggregateId)) context.addIssue({ code: 'custom', message: 'Image identities must match aggregate' });
});
export type ProjectSnapshot = z.infer<typeof projectSnapshotSchema>;

const homepageHeroSnapshotBaseSchema = z.object({
  aggregateType: z.literal('homepage_hero'), aggregateId: z.literal(SINGLETON_AGGREGATE_ID), videos: z.array(canonicalHomepageVideoRowSchema),
}).strict();
export const homepageHeroSnapshotSchema = homepageHeroSnapshotBaseSchema;
export type HomepageHeroSnapshot = z.infer<typeof homepageHeroSnapshotSchema>;

const siteSettingsSnapshotBaseSchema = z.object({
  aggregateType: z.literal('site_settings'), aggregateId: z.literal(SINGLETON_AGGREGATE_ID), settings: canonicalSiteSettingsRowSchema,
}).strict();
export const siteSettingsSnapshotSchema = siteSettingsSnapshotBaseSchema;
export type SiteSettingsSnapshot = z.infer<typeof siteSettingsSnapshotSchema>;

export const contentSnapshotSchema = z.discriminatedUnion('aggregateType', [projectSnapshotSchema, homepageHeroSnapshotSchema, siteSettingsSnapshotSchema]);
export type ContentSnapshot = z.infer<typeof contentSnapshotSchema>;

const aggregateMatches = (aggregateType: ContentAggregateType, aggregateId: string, snapshot: ContentSnapshot): boolean =>
  snapshot.aggregateType === aggregateType && snapshot.aggregateId === aggregateId && (aggregateType === 'project' || aggregateId === SINGLETON_AGGREGATE_ID);

const revisionRecordBaseSchema = z.object({
  id: postgresUuidSchema, aggregateType: contentAggregateTypeSchema, aggregateId: nonemptyStringSchema, revisionNumber: positiveIntegerSchema, state: contentRevisionStateSchema,
  action: contentRevisionActionSchema, snapshot: contentSnapshotSchema, expectedRevisionId: postgresUuidSchema.nullable(), createdBy: positiveIntegerSchema.nullable(), approvedBy: positiveIntegerSchema.nullable(),
  createdAt: isoDateTimeSchema, approvedAt: isoDateTimeSchema.nullable(),
}).strict();
export const revisionRecordSchema = revisionRecordBaseSchema.superRefine((value, context) => {
  if (!aggregateMatches(value.aggregateType, value.aggregateId, value.snapshot)) context.addIssue({ code: 'custom', message: 'Aggregate and snapshot must match' });
  if (value.action === 'baseline' && (value.state !== 'approved' || value.revisionNumber !== 1 || value.expectedRevisionId !== null || value.createdBy !== null)) context.addIssue({ code: 'custom', message: 'Baseline metadata is invalid' });
  if (value.action === 'proposal' && value.createdBy === null) context.addIssue({ code: 'custom', message: 'Proposals require a creator' });
  if ((value.action === 'publish' || value.action === 'rollback' || value.action === 'delete') && (value.state !== 'approved' || value.createdBy === null)) context.addIssue({ code: 'custom', message: 'Publication actions require approval and a creator' });
  if ((value.state === 'pending' || value.state === 'rejected') && (value.approvedBy !== null || value.approvedAt !== null)) context.addIssue({ code: 'custom', message: 'Unapproved states cannot have approval metadata' });
  if (value.state === 'approved' && (value.approvedAt === null || (value.action === 'baseline' ? value.approvedBy !== null : value.approvedBy === null))) context.addIssue({ code: 'custom', message: 'Approved metadata is invalid' });
});
export type RevisionRecord = z.infer<typeof revisionRecordSchema>;

const revisionHeadBaseSchema = z.object({
  aggregateType: contentAggregateTypeSchema, aggregateId: nonemptyStringSchema, currentRevisionId: postgresUuidSchema, currentRevisionNumber: positiveIntegerSchema,
}).strict();
export const revisionHeadSchema = revisionHeadBaseSchema.refine((value) => value.aggregateType === 'project' || value.aggregateId === SINGLETON_AGGREGATE_ID, 'Singleton aggregates require singleton identity');
export type RevisionHead = z.infer<typeof revisionHeadSchema>;

export const revisionIdSchema = postgresUuidSchema;

const snapshotCommandBaseSchema = z.object({
  aggregateType: contentAggregateTypeSchema, aggregateId: nonemptyStringSchema, snapshot: contentSnapshotSchema, expectedRevisionId: postgresUuidSchema.nullable(),
  mediaFileIds: z.array(nonemptyStringSchema).refine((values) => new Set(values).size === values.length, 'Media file IDs must be unique'),
}).strict();
const refineSnapshotCommand = (value: { readonly aggregateType: ContentAggregateType; readonly aggregateId: string; readonly snapshot: ContentSnapshot }, context: z.RefinementCtx): void => {
  if (!aggregateMatches(value.aggregateType, value.aggregateId, value.snapshot)) context.addIssue({ code: 'custom', message: 'Aggregate and snapshot must match' });
};
export const createProposalInputSchema = snapshotCommandBaseSchema.superRefine(refineSnapshotCommand);
export type CreateProposalInput = z.infer<typeof createProposalInputSchema>;
export const publishOwnRevisionInputSchema = snapshotCommandBaseSchema.safeExtend({ confirmPublish: z.literal(true) }).superRefine(refineSnapshotCommand);
export type PublishOwnRevisionInput = z.infer<typeof publishOwnRevisionInputSchema>;

const headActionInputBaseSchema = z.object({ revisionId: revisionIdSchema, expectedCurrentRevisionId: postgresUuidSchema.nullable() }).strict();
export const approveRevisionInputSchema = headActionInputBaseSchema;
export type ApproveRevisionInput = z.infer<typeof approveRevisionInputSchema>;
export const rejectRevisionInputSchema = headActionInputBaseSchema;
export type RejectRevisionInput = z.infer<typeof rejectRevisionInputSchema>;
const rollbackRevisionInputBaseSchema = z.object({ targetRevisionId: revisionIdSchema, expectedCurrentRevisionId: postgresUuidSchema }).strict();
export const rollbackRevisionInputSchema = rollbackRevisionInputBaseSchema;
export type RollbackRevisionInput = z.infer<typeof rollbackRevisionInputSchema>;
const deleteProjectInputBaseSchema = z.object({ aggregateType: z.literal('project'), aggregateId: nonemptyStringSchema, expectedCurrentRevisionId: postgresUuidSchema }).strict();
export const deleteProjectInputSchema = deleteProjectInputBaseSchema;
export type DeleteProjectInput = z.infer<typeof deleteProjectInputSchema>;
const proposalActionInputSchema = snapshotCommandBaseSchema.safeExtend({ action: z.literal('proposal') }).superRefine(refineSnapshotCommand);
const publishActionInputSchema = snapshotCommandBaseSchema.safeExtend({ action: z.literal('publish'), confirmPublish: z.literal(true) }).superRefine(refineSnapshotCommand);
const approveActionInputSchema = headActionInputBaseSchema.safeExtend({ action: z.literal('approve') });
const rejectActionInputSchema = headActionInputBaseSchema.safeExtend({ action: z.literal('reject') });
const rollbackActionInputSchema = rollbackRevisionInputBaseSchema.safeExtend({ action: z.literal('rollback') });
const deleteActionInputSchema = deleteProjectInputBaseSchema.safeExtend({ action: z.literal('delete') });
export const revisionActionInputSchema = z.discriminatedUnion('action', [proposalActionInputSchema, publishActionInputSchema, approveActionInputSchema, rejectActionInputSchema, rollbackActionInputSchema, deleteActionInputSchema]);
export type RevisionActionInput = z.infer<typeof revisionActionInputSchema>;

export type RevisionError =
  | { readonly kind: 'revision_conflict'; readonly expectedRevisionId: string | null; readonly currentRevisionId: string | null }
  | { readonly kind: 'revision_not_found'; readonly revisionId: string }
  | { readonly kind: 'aggregate_not_found'; readonly aggregateType: ContentAggregateType; readonly aggregateId: string }
  | { readonly kind: 'invalid_transition'; readonly revisionId: string; readonly state: ContentRevisionState }
  | { readonly kind: 'snapshot_invalid'; readonly aggregateType: ContentAggregateType; readonly aggregateId: string };
export type RevisionResult<Value> = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: RevisionError };

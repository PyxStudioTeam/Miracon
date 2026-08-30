import { z } from 'zod';
import type { AdminRole } from './auth/admin-role';
import type {
  ContentAggregateType,
  ContentAuditAction,
  ContentRevisionAction,
  ContentRevisionState,
  ContentSnapshot,
  RevisionRecord,
} from './revision-contracts';
import { revisionRecordSchema } from './revision-contracts';
import { parseStoredSnapshot } from './revision-materializers';

export type RevisionQueryResult = {
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly rowCount: number | null;
};

export interface RevisionTransaction {
  query(text: string, values?: readonly unknown[]): Promise<RevisionQueryResult>;
  release(): void;
}

export interface RevisionPool {
  connect(): Promise<RevisionTransaction>;
}

export type RevisionActor = {
  readonly actorId: number;
  readonly sessionId: string;
  readonly role: AdminRole;
};

export type RevisionHeadState = {
  readonly currentRevisionId: string;
  readonly currentRevisionNumber: number;
  readonly snapshot: ContentSnapshot;
};

export type StoredRevision = RevisionRecord;

type NewRevision = {
  readonly aggregateType: ContentAggregateType;
  readonly aggregateId: string;
  readonly revisionNumber: number;
  readonly state: ContentRevisionState;
  readonly action: ContentRevisionAction;
  readonly snapshot: ContentSnapshot;
  readonly expectedRevisionId: string | null;
  readonly actorId: number;
};

type AuditWrite = {
  readonly actor: RevisionActor;
  readonly aggregateType: ContentAggregateType;
  readonly aggregateId: string;
  readonly revisionId: string;
  readonly action: ContentAuditAction;
  readonly before: ContentSnapshot;
  readonly after: ContentSnapshot;
};

const discoveredSessionSchema = z.object({
  id: z.string().min(1),
  admin_user_id: z.number().int().positive(),
  session_token_hash: z.instanceof(Buffer),
});
const actorSchema = z.object({ actor_id: z.number().int().positive(), session_id: z.string().min(1), role: z.enum(['owner', 'editor']) });
const databaseUuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
const headSchema = z.object({ current_revision_id: databaseUuidSchema, current_revision_number: z.coerce.number().int().positive(), snapshot: z.unknown() });
const revisionRowSchema = z.object({
  id: databaseUuidSchema, aggregate_type: z.enum(['project', 'homepage_hero', 'site_settings']), aggregate_id: z.string().min(1), revision_number: z.coerce.number().int().positive(),
  state: z.enum(['pending', 'approved', 'rejected']), action: z.enum(['baseline', 'proposal', 'publish', 'rollback', 'delete']), snapshot: z.unknown(),
  expected_revision_id: databaseUuidSchema.nullable(), created_by: z.number().int().positive().nullable(), approved_by: z.number().int().positive().nullable(),
  created_at: z.coerce.date(), approved_at: z.coerce.date().nullable(),
});

export class RevisionRepository {
  constructor(private readonly transaction: RevisionTransaction) {}

  async discoverSession(digest: Buffer) {
    const result = await this.transaction.query(`/* revision:discover-session */
      select id, admin_user_id, session_token_hash from miracon.admin_sessions where session_token_hash = $1`, [digest]);
    const row = result.rows[0];
    return row ? discoveredSessionSchema.parse(row) : null;
  }

  async lockAdmin(adminUserId: number): Promise<boolean> {
    const result = await this.transaction.query('/* revision:lock-admin */ select id from miracon.admin_users where id = $1 for update', [adminUserId]);
    return result.rows.length === 1;
  }

  async lockSession(adminUserId: number, sessionId: string, digest: Buffer): Promise<RevisionActor | null> {
    const result = await this.transaction.query(`/* revision:lock-session */
      select admin.id as actor_id, session.id as session_id, admin.role::text as role
      from miracon.admin_users as admin
      join miracon.admin_sessions as session on session.admin_user_id = admin.id
      where admin.id = $1 and session.id = $2 and session.session_token_hash = $3
        and admin.is_active and session.revoked_at is null and session.expires_at > clock_timestamp()
      for update of session`, [adminUserId, sessionId, digest]);
    const row = result.rows[0];
    if (!row) return null;
    const actor = actorSchema.parse(row);
    return { actorId: actor.actor_id, sessionId: actor.session_id, role: actor.role };
  }

  async resolveRevision(revisionId: string): Promise<{ readonly aggregateType: ContentAggregateType; readonly aggregateId: string } | null> {
    const result = await this.transaction.query(`/* revision:resolve-revision */
      select aggregate_type::text, aggregate_id from miracon.content_revisions where id = $1`, [revisionId]);
    const parsed = z.object({ aggregate_type: z.enum(['project', 'homepage_hero', 'site_settings']), aggregate_id: z.string().min(1) }).safeParse(result.rows[0]);
    return parsed.success ? { aggregateType: parsed.data.aggregate_type, aggregateId: parsed.data.aggregate_id } : null;
  }

  async lockAggregate(aggregateType: ContentAggregateType, aggregateId: string): Promise<void> {
    await this.transaction.query(`/* revision:lock-aggregate */
      select pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))`, [aggregateType, aggregateId]);
  }

  async loadHead(aggregateType: ContentAggregateType, aggregateId: string): Promise<RevisionHeadState | null> {
    const result = await this.transaction.query(`/* revision:load-head */
      select head.current_revision_id, head.current_revision_number, revision.snapshot
      from miracon.content_revision_heads as head
      join miracon.content_revisions as revision on revision.id = head.current_revision_id
      where head.aggregate_type = $1 and head.aggregate_id = $2
      for update of head`, [aggregateType, aggregateId]);
    const parsed = headSchema.safeParse(result.rows[0]);
    return parsed.success ? { currentRevisionId: parsed.data.current_revision_id, currentRevisionNumber: parsed.data.current_revision_number, snapshot: parseStoredSnapshot(parsed.data.snapshot) } : null;
  }

  async loadRevision(revisionId: string): Promise<StoredRevision | null> {
    const result = await this.transaction.query(`/* revision:load-revision */
      select id, aggregate_type::text, aggregate_id, revision_number, state::text, action::text, snapshot,
        expected_revision_id, created_by, approved_by, created_at, approved_at
      from miracon.content_revisions where id = $1 for update`, [revisionId]);
    return result.rows[0] ? parseRevision(result.rows[0]) : null;
  }

  async allocateRevision(aggregateType: ContentAggregateType, aggregateId: string): Promise<number> {
    const result = await this.transaction.query(`/* revision:allocate-revision */
      select coalesce(max(revision_number), 0) + 1 as revision_number
      from miracon.content_revisions where aggregate_type = $1 and aggregate_id = $2`, [aggregateType, aggregateId]);
    return z.coerce.number().int().positive().parse(result.rows[0]?.['revision_number']);
  }

  async insertRevision(input: NewRevision): Promise<StoredRevision> {
    const approved = input.state === 'approved';
    const result = await this.transaction.query(`/* revision:insert-revision */
      insert into miracon.content_revisions
        (aggregate_type, aggregate_id, revision_number, state, action, snapshot, expected_revision_id, created_by, approved_by, approved_at)
      values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, case when $9::smallint is null then null else clock_timestamp() end)
      returning id, created_at, approved_at`, [input.aggregateType, input.aggregateId, input.revisionNumber, input.state, input.action, JSON.stringify(input.snapshot), input.expectedRevisionId, input.actorId, approved ? input.actorId : null]);
    const row = z.object({ id: databaseUuidSchema, created_at: z.coerce.date(), approved_at: z.coerce.date().nullable() }).parse(result.rows[0]);
    return revisionRecordSchema.parse({
      id: row.id, aggregateType: input.aggregateType, aggregateId: input.aggregateId, revisionNumber: input.revisionNumber,
      state: input.state, action: input.action, snapshot: input.snapshot, expectedRevisionId: input.expectedRevisionId,
      createdBy: input.actorId, approvedBy: approved ? input.actorId : null, createdAt: row.created_at.toISOString(), approvedAt: row.approved_at?.toISOString() ?? null,
    });
  }

  async transitionProposal(revision: StoredRevision, state: 'approved' | 'rejected', actorId: number): Promise<StoredRevision> {
    const result = await this.transaction.query(`/* revision:transition-revision */
      update miracon.content_revisions set state = $2::miracon.content_revision_state,
        approved_by = case when $2::text = 'approved' then $3::smallint else null end,
        approved_at = case when $2::text = 'approved' then clock_timestamp() else null end
      where id = $1 and state = 'pending'
      returning approved_at`, [revision.id, state, actorId]);
    if (result.rowCount !== 1) throw new RevisionStateRaceError();
    const approvedAt = state === 'approved' ? z.coerce.date().parse(result.rows[0]?.['approved_at']).toISOString() : null;
    return revisionRecordSchema.parse({ ...revision, state, approvedBy: state === 'approved' ? actorId : null, approvedAt });
  }

  async validateAndInsertMedia(revisionId: string, mediaFileIds: readonly string[], aggregate: { readonly type: ContentAggregateType; readonly id: string }): Promise<void> {
    const ids = [...new Set(mediaFileIds)].sort();
    if (ids.length === 0) return;
    const result = await this.transaction.query('/* revision:validate-media */ select id from miracon.media_files where id = any($1::text[]) order by id for key share', [ids]);
    const found = result.rows.map((row) => z.string().parse(row['id']));
    if (found.length !== ids.length || found.some((id, index) => id !== ids[index])) throw new InvalidSnapshotReferenceError(aggregate.type, aggregate.id);
    await this.transaction.query(`/* revision:insert-media */
      insert into miracon.revision_media (revision_id, media_file_id)
      select $1::uuid, id from unnest($2::text[]) as id order by id`, [revisionId, ids]);
  }

  async copyMedia(sourceRevisionId: string, revisionId: string): Promise<void> {
    await this.transaction.query(`/* revision:copy-media */
      insert into miracon.revision_media (revision_id, media_file_id)
      select $2, media_file_id from miracon.revision_media where revision_id = $1 order by media_file_id`, [sourceRevisionId, revisionId]);
  }

  async advanceHead(revision: StoredRevision, previousRevisionId: string | null): Promise<void> {
    const result = previousRevisionId === null
      ? await this.transaction.query(`/* revision:advance-head */ insert into miracon.content_revision_heads
          (aggregate_type, aggregate_id, current_revision_id, current_revision_number) values ($1, $2, $3, $4) returning current_revision_id`, [revision.aggregateType, revision.aggregateId, revision.id, revision.revisionNumber])
      : await this.transaction.query(`/* revision:advance-head */ update miracon.content_revision_heads
          set current_revision_id = $3, current_revision_number = $4
          where aggregate_type = $1 and aggregate_id = $2 and current_revision_id = $5 returning current_revision_id`, [revision.aggregateType, revision.aggregateId, revision.id, revision.revisionNumber, previousRevisionId]);
    if (result.rowCount !== 1) throw new RevisionHeadRaceError();
  }

  async insertAudit(input: AuditWrite): Promise<void> {
    await this.transaction.query(`/* revision:insert-audit */ insert into miracon.audit_events
      (actor_id, session_id, aggregate_type, aggregate_id, revision_id, action, before_snapshot, after_snapshot)
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`, [input.actor.actorId, input.actor.sessionId, input.aggregateType, input.aggregateId, input.revisionId, input.action, JSON.stringify(input.before), JSON.stringify(input.after)]);
  }
}

const parseRevision = (value: Readonly<Record<string, unknown>>): StoredRevision => {
  const row = revisionRowSchema.parse(value);
  return revisionRecordSchema.parse({
    id: row.id, aggregateType: row.aggregate_type, aggregateId: row.aggregate_id, revisionNumber: row.revision_number,
    state: row.state, action: row.action, snapshot: parseStoredSnapshot(row.snapshot), expectedRevisionId: row.expected_revision_id,
    createdBy: row.created_by, approvedBy: row.approved_by, createdAt: row.created_at.toISOString(), approvedAt: row.approved_at?.toISOString() ?? null,
  });
};

export class RevisionStateRaceError extends Error { readonly name = 'RevisionStateRaceError'; }
export class RevisionHeadRaceError extends Error { readonly name = 'RevisionHeadRaceError'; }
export class InvalidSnapshotReferenceError extends Error {
  readonly name = 'InvalidSnapshotReferenceError';
  constructor(readonly aggregateType: ContentAggregateType, readonly aggregateId: string) { super('Snapshot references invalid media'); }
}

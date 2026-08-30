import { z } from 'zod';
import type { AdminRole } from './auth/admin-role';
import type {
  ContentAggregateType,
  ContentRevisionAction,
  ContentRevisionState,
  ContentSnapshot,
} from './revision-contracts';
import { parseStoredSnapshot } from './revision-materializers';
import type { RevisionPool } from './revisions';

export type PendingProposal = {
  readonly id: string;
  readonly aggregateType: ContentAggregateType;
  readonly aggregateId: string;
  readonly revisionNumber: number;
  readonly state: ContentRevisionState;
  readonly action: ContentRevisionAction;
  readonly snapshot: ContentSnapshot;
  readonly expectedRevisionId: string | null;
  readonly createdBy: number;
  readonly creatorEmail: string;
  readonly creatorRole: AdminRole;
  readonly createdAt: string;
  readonly currentHeadRevisionId: string | null;
};

export type RevisionHistoryItem = {
  readonly id: string;
  readonly aggregateType: ContentAggregateType;
  readonly aggregateId: string;
  readonly revisionNumber: number;
  readonly state: ContentRevisionState;
  readonly action: ContentRevisionAction;
  readonly snapshot: ContentSnapshot;
  readonly expectedRevisionId: string | null;
  readonly createdBy: number | null;
  readonly creatorEmail: string | null;
  readonly creatorRole: AdminRole | null;
  readonly approvedBy: number | null;
  readonly approverEmail: string | null;
  readonly approverRole: AdminRole | null;
  readonly createdAt: string;
  readonly approvedAt: string | null;
};

const databaseUuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);

const pendingProposalRowSchema = z.object({
  id: databaseUuidSchema,
  aggregate_type: z.enum(['project', 'homepage_hero', 'site_settings']),
  aggregate_id: z.string().min(1),
  revision_number: z.coerce.number().int().positive(),
  state: z.literal('pending'),
  action: z.literal('proposal'),
  snapshot: z.unknown(),
  expected_revision_id: databaseUuidSchema.nullable(),
  created_by: z.number().int().positive(),
  created_at: z.coerce.date(),
  creator_email: z.string().min(1),
  creator_role: z.enum(['owner', 'editor']),
  current_head_revision_id: databaseUuidSchema.nullable(),
});

const revisionHistoryRowSchema = z.object({
  id: databaseUuidSchema,
  aggregate_type: z.enum(['project', 'homepage_hero', 'site_settings']),
  aggregate_id: z.string().min(1),
  revision_number: z.coerce.number().int().positive(),
  state: z.enum(['pending', 'approved', 'rejected']),
  action: z.enum(['baseline', 'proposal', 'publish', 'rollback', 'delete']),
  snapshot: z.unknown(),
  expected_revision_id: databaseUuidSchema.nullable(),
  created_by: z.number().int().positive().nullable(),
  approved_by: z.number().int().positive().nullable(),
  created_at: z.coerce.date(),
  approved_at: z.coerce.date().nullable(),
  creator_email: z.string().nullable(),
  creator_role: z.enum(['owner', 'editor']).nullable(),
  approver_email: z.string().nullable(),
  approver_role: z.enum(['owner', 'editor']).nullable(),
});

export async function getPendingProposals(pool: RevisionPool): Promise<PendingProposal[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(`/* revisions:get-pending-proposals */
      select r.id, r.aggregate_type::text as aggregate_type, r.aggregate_id, r.revision_number,
             r.state::text as state, r.action::text as action, r.snapshot, r.expected_revision_id,
             r.created_by, r.created_at,
             u.email as creator_email, u.role::text as creator_role,
             h.current_revision_id as current_head_revision_id
      from miracon.content_revisions as r
      join miracon.admin_users as u on u.id = r.created_by
      left join miracon.content_revision_heads as h
        on h.aggregate_type = r.aggregate_type and h.aggregate_id = r.aggregate_id
      where r.state = 'pending'
      order by r.created_at desc
    `);

    return result.rows.map((row) => {
      const parsed = pendingProposalRowSchema.parse(row);
      return {
        id: parsed.id,
        aggregateType: parsed.aggregate_type,
        aggregateId: parsed.aggregate_id,
        revisionNumber: parsed.revision_number,
        state: parsed.state,
        action: parsed.action,
        snapshot: parseStoredSnapshot(parsed.snapshot),
        expectedRevisionId: parsed.expected_revision_id,
        createdBy: parsed.created_by,
        creatorEmail: parsed.creator_email,
        creatorRole: parsed.creator_role,
        createdAt: parsed.created_at.toISOString(),
        currentHeadRevisionId: parsed.current_head_revision_id,
      };
    });
  } finally {
    client.release();
  }
}

export async function getAggregateRevisionHistory(
  pool: RevisionPool,
  aggregateType: ContentAggregateType,
  aggregateId: string,
): Promise<RevisionHistoryItem[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(`/* revisions:get-aggregate-history */
      select r.id, r.aggregate_type::text as aggregate_type, r.aggregate_id, r.revision_number,
             r.state::text as state, r.action::text as action, r.snapshot, r.expected_revision_id,
             r.created_by, r.approved_by, r.created_at, r.approved_at,
             creator.email as creator_email, creator.role::text as creator_role,
             approver.email as approver_email, approver.role::text as approver_role
      from miracon.content_revisions as r
      left join miracon.admin_users as creator on creator.id = r.created_by
      left join miracon.admin_users as approver on approver.id = r.approved_by
      where r.aggregate_type = $1 and r.aggregate_id = $2
      order by r.revision_number desc
    `, [aggregateType, aggregateId]);

    return result.rows.map((row) => {
      const parsed = revisionHistoryRowSchema.parse(row);
      return {
        id: parsed.id,
        aggregateType: parsed.aggregate_type,
        aggregateId: parsed.aggregate_id,
        revisionNumber: parsed.revision_number,
        state: parsed.state,
        action: parsed.action,
        snapshot: parseStoredSnapshot(parsed.snapshot),
        expectedRevisionId: parsed.expected_revision_id,
        createdBy: parsed.created_by,
        creatorEmail: parsed.creator_email,
        creatorRole: parsed.creator_role,
        approvedBy: parsed.approved_by,
        approverEmail: parsed.approver_email,
        approverRole: parsed.approver_role,
        createdAt: parsed.created_at.toISOString(),
        approvedAt: parsed.approved_at?.toISOString() ?? null,
      };
    });
  } finally {
    client.release();
  }
}

export async function getAggregateHeadRevision(
  pool: RevisionPool,
  aggregateType: ContentAggregateType,
  aggregateId: string,
): Promise<{ readonly currentRevisionId: string; readonly currentRevisionNumber: number; readonly snapshot: ContentSnapshot } | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(`/* revisions:get-aggregate-head */
      select h.current_revision_id, h.current_revision_number, r.snapshot
      from miracon.content_revision_heads as h
      join miracon.content_revisions as r on r.id = h.current_revision_id
      where h.aggregate_type = $1 and h.aggregate_id = $2
    `, [aggregateType, aggregateId]);

    const row = result.rows[0];
    if (!row) return null;
    return {
      currentRevisionId: z.string().parse(row['current_revision_id']),
      currentRevisionNumber: z.coerce.number().int().positive().parse(row['current_revision_number']),
      snapshot: parseStoredSnapshot(row['snapshot']),
    };
  } finally {
    client.release();
  }
}

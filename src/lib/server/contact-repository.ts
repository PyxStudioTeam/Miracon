import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { contactIdSchema, type ContactId, type ContactSubmissionInput } from './contact-contracts';

export const CONTACT_HOURLY_LIMIT = 5;
export const CONTACT_DUPLICATE_WINDOW_MINUTES = 15;
export const CONTACT_CHALLENGE_HOURLY_LIMIT = 20;
export const CONTACT_CHALLENGE_COOLDOWN_MS = 3_000;

export type ContactChallengeRecord = {
  readonly tokenDigest: Buffer;
  readonly clientDigest: Buffer;
  readonly createdAt: Date;
  readonly notBefore: Date;
  readonly expiresAt: Date;
};

export type ContactSubmissionRecord = Omit<ContactSubmissionInput, 'challenge' | 'consent' | 'website'> & {
  readonly id: ContactId;
  readonly challengeDigest: Buffer;
  readonly clientDigest: Buffer;
  readonly duplicateDigest: Buffer;
  readonly isSpam: boolean;
  readonly createdAt: Date;
};

export type ContactSubmissionResult =
  | { readonly kind: 'accepted'; readonly id: ContactId }
  | { readonly kind: 'invalid_challenge' }
  | { readonly kind: 'too_fast' }
  | { readonly kind: 'rate_limited' }
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'spam' };

export type ContactChallengeIssueResult =
  | { readonly kind: 'issued' }
  | { readonly kind: 'rate_limited' };

export type ContactSummary = {
  readonly id: ContactId;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly locale: 'en' | 'el';
  readonly sourcePath: string;
  readonly createdAt: Date;
};

export type ContactDetail = ContactSummary & {
  readonly message: string;
  readonly consentedAt: Date;
};

export interface ContactIntakeRepository {
  createChallenge(record: ContactChallengeRecord): Promise<ContactChallengeIssueResult>;
  acceptSubmission(record: ContactSubmissionRecord): Promise<ContactSubmissionResult>;
}

interface ChallengeRow extends QueryResultRow {
  readonly not_before: Date;
}

interface ContactRow extends QueryResultRow {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly locale: 'en' | 'el';
  readonly source_path: string;
  readonly created_at: Date;
}

interface ContactDetailRow extends ContactRow {
  readonly message: string;
  readonly consented_at: Date;
}

export class PostgresContactRepository implements ContactIntakeRepository {
  constructor(private readonly database: Pool) {}

  async createChallenge(record: ContactChallengeRecord): Promise<ContactChallengeIssueResult> {
    const client = await this.database.connect();
    const hourlyCutoff = new Date(record.createdAt.getTime() - 60 * 60 * 1_000);
    try {
      await client.query('begin');
      await client.query(
        `select pg_advisory_xact_lock(hashtextextended(encode($1::bytea, 'hex'), 0))`,
        [record.clientDigest],
      );
      await client.query(
         `delete from miracon.contact_challenges
         where client_digest = $1
           and created_at <= $2
           and (consumed_at is not null or expires_at <= $3)`,
        [record.clientDigest, hourlyCutoff, record.createdAt],
      );
      const issuance = await client.query<{ readonly count: number; readonly latest_created_at: Date | null }>(
         `select count(*)::integer as count, max(created_at) as latest_created_at
         from miracon.contact_challenges
         where client_digest = $1 and created_at > $2`,
        [record.clientDigest, hourlyCutoff],
      );
      const issuanceRow = issuance.rows[0];
      const withinCooldown = issuanceRow?.latest_created_at !== null
        && issuanceRow?.latest_created_at !== undefined
        && issuanceRow.latest_created_at.getTime() > record.createdAt.getTime() - CONTACT_CHALLENGE_COOLDOWN_MS;
      if ((issuanceRow?.count ?? 0) >= CONTACT_CHALLENGE_HOURLY_LIMIT || withinCooldown) {
        await client.query('commit');
        return { kind: 'rate_limited' };
      }
      await client.query(
        `insert into miracon.contact_challenges
           (token_digest, client_digest, created_at, not_before, expires_at)
         values ($1, $2, $3, $4, $5)`,
        [record.tokenDigest, record.clientDigest, record.createdAt, record.notBefore, record.expiresAt],
      );
      await client.query('commit');
      return { kind: 'issued' };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async acceptSubmission(record: ContactSubmissionRecord): Promise<ContactSubmissionResult> {
    const client = await this.database.connect();
    try {
      await client.query('begin');
      const result = await this.acceptInTransaction(client, record);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async list(limit: number, offset: number): Promise<readonly ContactSummary[]> {
    const result = await this.database.query<ContactDetailRow>(
      `select id::text, name, email, phone, locale, source_path, created_at
       from miracon.contact_submissions
       order by created_at desc, id desc
       limit $1 offset $2`,
      [limit, offset],
    );
    return result.rows.map(mapSummary);
  }

  async get(id: ContactId): Promise<ContactDetail | null> {
    const result = await this.database.query<ContactRow>(
      `select id::text, name, email, phone, message, consented_at, locale, source_path, created_at
       from miracon.contact_submissions where id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { ...mapSummary(row), message: row.message, consentedAt: row.consented_at };
  }

  async delete(id: ContactId): Promise<boolean> {
    const result = await this.database.query('delete from miracon.contact_submissions where id = $1', [id]);
    return result.rowCount === 1;
  }

  private async acceptInTransaction(
    client: PoolClient,
    record: ContactSubmissionRecord,
  ): Promise<ContactSubmissionResult> {
    const hourlyCutoff = new Date(record.createdAt.getTime() - 60 * 60 * 1_000);
    const duplicateCutoff = new Date(
      record.createdAt.getTime() - CONTACT_DUPLICATE_WINDOW_MINUTES * 60 * 1_000,
    );
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended(lock_key, 0))
       from unnest(array[encode($1::bytea, 'hex'), encode($2::bytea, 'hex')]) as locks(lock_key)
       order by lock_key`,
      [record.clientDigest, record.duplicateDigest],
    );
    const challenge = await client.query<ChallengeRow>(
      `update miracon.contact_challenges
       set consumed_at = $3
       where token_digest = $1 and client_digest = $2
         and consumed_at is null and expires_at > $3
       returning not_before`,
      [record.challengeDigest, record.clientDigest, record.createdAt],
    );
    const challengeRow = challenge.rows[0];
    if (!challengeRow) return { kind: 'invalid_challenge' };
    if (challengeRow.not_before > record.createdAt) return { kind: 'too_fast' };
    if (record.isSpam) return { kind: 'spam' };

    const rate = await client.query<{ readonly count: number }>(
      `select count(*)::integer as count from miracon.contact_submissions
       where client_digest = $1 and created_at > $2`,
      [record.clientDigest, hourlyCutoff],
    );
    if ((rate.rows[0]?.count ?? 0) >= CONTACT_HOURLY_LIMIT) return { kind: 'rate_limited' };

    const duplicate = await client.query(
      `select 1 from miracon.contact_submissions
       where duplicate_digest = $1 and created_at > $2
       limit 1`,
      [record.duplicateDigest, duplicateCutoff],
    );
    if (duplicate.rowCount === 1) return { kind: 'duplicate' };

    await client.query(
      `insert into miracon.contact_submissions
         (id, name, email, phone, message, consented_at, locale, source_path,
          client_digest, duplicate_digest, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $6)`,
      [record.id, record.name, record.email ?? null, record.phone ?? null, record.message,
        record.createdAt, record.locale, record.sourcePath, record.clientDigest, record.duplicateDigest],
    );
    return { kind: 'accepted', id: record.id };
  }
}

function mapSummary(row: ContactRow): ContactSummary {
  return {
    id: contactIdSchema.parse(row.id),
    name: row.name,
    email: row.email,
    phone: row.phone,
    locale: row.locale,
    sourcePath: row.source_path,
    createdAt: row.created_at,
  };
}

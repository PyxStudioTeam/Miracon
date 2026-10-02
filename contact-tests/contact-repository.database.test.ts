import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../scripts/postgres-migrate.mjs';
import type { ContactChallengeToken } from '../src/lib/server/contact-contracts';
import { PostgresContactRepository } from '../src/lib/server/contact-repository';
import { issueContactChallenge, submitContact } from '../src/lib/server/contact-service';

const databaseUrl = requireSafeDatabaseUrl();
const digestSecret = 'contact-database-test-secret-at-least-thirty-two-bytes';
const pool = new Pool({ connectionString: databaseUrl, max: 10 });

beforeAll(async () => {
  await pool.query('drop schema if exists miracon cascade; drop schema if exists miracon_meta cascade');
  await migrate(databaseUrl);
});

beforeEach(async () => {
  await pool.query('truncate miracon.contact_mail_jobs, miracon.contact_submissions, miracon.contact_challenges');
});

afterAll(async () => {
  await pool.end();
});

describe('contact repository concurrency', () => {
  it('cleans an expired challenge older than the hourly issuance window', async () => {
    // Given
    const repository = new PostgresContactRepository(pool);
    const clientAddress = '203.0.113.19';
    const clientDigest = createHmac('sha256', digestSecret)
      .update(`miracon-contact/client/v1\0${clientAddress}`, 'utf8')
      .digest();
    await pool.query(
      `insert into miracon.contact_challenges
         (token_digest, client_digest, created_at, expires_at)
       values ($1, $2, $3, $4)`,
      [Buffer.alloc(32, 19), clientDigest, atSecond(-3_601), atSecond(-2_698)],
    );

    // When
    const result = await issueContactChallenge(repository, { clientAddress, digestSecret, now: atSecond(0) });

    // Then
    expect(result.kind).toBe('issued');
    const retained = await pool.query<{ readonly count: number }>(
      'select count(*)::integer as count from miracon.contact_challenges where client_digest = $1',
      [clientDigest],
    );
    expect(retained.rows[0]?.count).toBe(1);
  });

  it('preserves historical challenge rows when the dwell column is removed', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `alter table miracon.contact_challenges
           drop constraint contact_challenges_expiry_after_creation_check,
           add column not_before timestamptz not null,
           add constraint old_dwell_check check (not_before > created_at),
           add constraint old_expiry_check check (expires_at > not_before)`,
      );
      const tokenDigest = Buffer.alloc(32, 77);
      const expiresAt = atSecond(900);
      await client.query(
        `insert into miracon.contact_challenges
           (token_digest, client_digest, created_at, not_before, expires_at)
         values ($1, $2, $3, $4, $5)`,
        [tokenDigest, Buffer.alloc(32, 78), atSecond(0), atSecond(3), expiresAt],
      );

      const migration = await readFile(
        new URL('../postgres/migrations/0014_contact_challenge_immediate.sql', import.meta.url), 'utf8',
      );
      await client.query(migration);
      const retained = await client.query<{ readonly token_digest: Buffer; readonly expires_at: Date }>(
        'select token_digest, expires_at from miracon.contact_challenges where token_digest = $1',
        [tokenDigest],
      );
      const dropped = await client.query(
        `select 1 from information_schema.columns
         where table_schema = 'miracon' and table_name = 'contact_challenges' and column_name = 'not_before'`,
      );

      expect(retained.rows).toEqual([{ token_digest: tokenDigest, expires_at: expiresAt }]);
      expect(dropped.rowCount).toBe(0);
      await client.query('savepoint invalid_expiry');
      await expect(client.query(
        `insert into miracon.contact_challenges
           (token_digest, client_digest, created_at, expires_at)
         values ($1, $2, $3, $4)`,
        [Buffer.alloc(32, 79), Buffer.alloc(32, 80), atSecond(0), atSecond(0)],
      )).rejects.toMatchObject({ code: '23514' });
      await client.query('rollback to savepoint invalid_expiry');
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('accepts an immediate submission but never accepts a replay of the same challenge', async () => {
    const repository = new PostgresContactRepository(pool);
    const clientAddress = '203.0.113.26';
    const issued = await challenge(repository, clientAddress, atSecond(0));

    const accepted = await submission({
      repository, challengeToken: issued, clientAddress, message: 'Immediate submission', now: atSecond(0),
    });
    const replayed = await submission({
      repository, challengeToken: issued, clientAddress, message: 'Immediate submission', now: atSecond(0),
    });

    expect(accepted.kind).toBe('accepted');
    expect(replayed.kind).toBe('invalid_challenge');
    await expect(submissionCount()).resolves.toBe(1);
  });

  it('rejects a different client without consuming the rightful client challenge', async () => {
    const repository = new PostgresContactRepository(pool);
    const token = await challenge(repository, '203.0.113.27', atSecond(0));

    const impostor = await submission({
      repository, challengeToken: token, clientAddress: '203.0.113.28', message: 'Rightful client',
      now: atSecond(0),
    });
    const rightful = await submission({
      repository, challengeToken: token, clientAddress: '203.0.113.27', message: 'Rightful client',
      now: atSecond(0),
    });

    expect(impostor.kind).toBe('invalid_challenge');
    expect(rightful.kind).toBe('accepted');
    await expect(submissionCount()).resolves.toBe(1);
  });

  it('rejects an expired challenge even when it has not been consumed', async () => {
    const repository = new PostgresContactRepository(pool);
    const clientAddress = '203.0.113.29';
    const token = await challenge(repository, clientAddress, atSecond(0));

    const result = await submission({
      repository, challengeToken: token, clientAddress, message: 'Expired challenge',
      now: atSecond(900),
    });

    expect(result.kind).toBe('invalid_challenge');
    await expect(submissionCount()).resolves.toBe(0);
  });

  it('accepts exactly one of two concurrent replays of one challenge', async () => {
    // Given
    const repository = new PostgresContactRepository(pool);
    const issued = await challenge(repository, '203.0.113.20', atSecond(0));

    // When
    const results = await Promise.all([
      submission({ repository, challengeToken: issued, clientAddress: '203.0.113.20', message: 'Replay test', now: atSecond(0) }),
      submission({ repository, challengeToken: issued, clientAddress: '203.0.113.20', message: 'Replay test', now: atSecond(0) }),
    ]);

    // Then
    expect(results.map((result) => result.kind).sort()).toEqual(['accepted', 'invalid_challenge']);
    await expect(submissionCount()).resolves.toBe(1);
  });

  it('accepts exactly one concurrent submission with duplicate content', async () => {
    // Given
    const repository = new PostgresContactRepository(pool);
    const firstChallenge = await challenge(repository, '203.0.113.21', atSecond(0));
    const secondChallenge = await challenge(repository, '203.0.113.22', atSecond(0));

    // When
    const results = await Promise.all([
      submission({ repository, challengeToken: firstChallenge, clientAddress: '203.0.113.21', message: 'Duplicate test', now: atSecond(0) }),
      submission({ repository, challengeToken: secondChallenge, clientAddress: '203.0.113.22', message: 'Duplicate test', now: atSecond(0) }),
    ]);

    // Then
    expect(results.map((result) => result.kind).sort()).toEqual(['accepted', 'duplicate']);
    await expect(submissionCount()).resolves.toBe(1);
  });

  it('accepts equivalent content again at the fifteen-minute duplicate boundary', async () => {
    const repository = new PostgresContactRepository(pool);
    const first = await challenge(repository, '203.0.113.30', atSecond(0));
    const second = await challenge(repository, '203.0.113.31', atSecond(900));

    const initial = await submission({
      repository, challengeToken: first, clientAddress: '203.0.113.30',
      message: 'Boundary submission', now: atSecond(0),
    });
    const afterWindow = await submission({
      repository, challengeToken: second, clientAddress: '203.0.113.31',
      message: 'Boundary submission', now: atSecond(900),
    });

    expect(initial.kind).toBe('accepted');
    expect(afterWindow.kind).toBe('accepted');
    await expect(submissionCount()).resolves.toBe(2);
  });

  it('never accepts more than five same-client submissions in an hour', async () => {
    // Given
    const repository = new PostgresContactRepository(pool);
    const clientAddress = '203.0.113.23';
    for (let index = 0; index < 4; index += 1) {
      const issued = await challenge(repository, clientAddress, atSecond(index * 8));
      const result = await submission({
        repository,
        challengeToken: issued,
        clientAddress,
        message: `Existing ${index}`,
        now: atSecond(index * 8 + 4),
      });
      expect(result.kind).toBe('accepted');
    }
    const firstChallenge = await challenge(repository, clientAddress, atSecond(40));
    const secondChallenge = await challenge(repository, clientAddress, atSecond(44));

    // When
    const results = await Promise.all([
      submission({ repository, challengeToken: firstChallenge, clientAddress, message: 'Fifth candidate', enqueueAcknowledgement: true, now: atSecond(48) }),
      submission({ repository, challengeToken: secondChallenge, clientAddress, message: 'Sixth candidate', enqueueAcknowledgement: true, now: atSecond(48) }),
    ]);

    // Then
    expect(results.map((result) => result.kind).sort()).toEqual(['accepted', 'rate_limited']);
    await expect(submissionCount()).resolves.toBe(5);
    const jobs = await mailJobs();
    expect(jobs.filter((job) => job.kind === 'team')).toHaveLength(5);
    expect(jobs.filter((job) => job.kind === 'ack')).toHaveLength(1);
  });

  it('serializes per-client challenge issuance at twenty per hour without a cooldown', async () => {
    const repository = new PostgresContactRepository(pool);
    const clientAddress = '203.0.113.24';

    const results = [];
    for (let index = 0; index < 20; index += 1) {
      results.push(await issueContactChallenge(repository, {
        clientAddress,
        digestSecret,
        now: atSecond(0),
      }));
    }
    const ceiling = await issueContactChallenge(repository, { clientAddress, digestSecret, now: atSecond(0) });

    expect(results.every((result) => result.kind === 'issued')).toBe(true);
    expect(ceiling.kind).toBe('rate_limited');
  });

  it('issues only the twentieth challenge at a concurrent hourly ceiling', async () => {
    // Given
    const repository = new PostgresContactRepository(pool);
    const clientAddress = '203.0.113.25';
    for (let index = 0; index < 19; index += 1) {
      const result = await issueContactChallenge(repository, {
        clientAddress,
        digestSecret,
        now: atSecond(0),
      });
      expect(result.kind).toBe('issued');
    }

    // When
    const results = await Promise.all([
      issueContactChallenge(repository, { clientAddress, digestSecret, now: atSecond(0) }),
      issueContactChallenge(repository, { clientAddress, digestSecret, now: atSecond(0) }),
    ]);

    // Then
    expect(results.filter((result) => result.kind === 'issued')).toHaveLength(1);
    expect(results.filter((result) => result.kind === 'rate_limited')).toHaveLength(1);
  });
  it('persists one team job per acceptance and one ack for concurrent clients sharing a case-insensitive email', async () => {
    const repository = new PostgresContactRepository(pool);
    const firstAddress = '203.0.113.41';
    const secondAddress = '203.0.113.42';
    const [firstToken, secondToken] = await Promise.all([
      challenge(repository, firstAddress, atSecond(0)),
      challenge(repository, secondAddress, atSecond(0)),
    ]);

    const results = await Promise.all([
      submission({
        repository, challengeToken: firstToken, clientAddress: firstAddress, message: 'First enquiry',
        email: 'Ada@Example.Test', enqueueAcknowledgement: true, now: atSecond(0),
      }),
      submission({
        repository, challengeToken: secondToken, clientAddress: secondAddress, message: 'Another enquiry',
        email: 'ada@example.test', enqueueAcknowledgement: true, now: atSecond(0),
      }),
    ]);

    expect(results.map((result) => result.kind)).toEqual(['accepted', 'accepted']);
    const jobs = await mailJobs();
    expect(jobs.filter((job) => job.kind === 'team')).toHaveLength(2);
    expect(jobs.filter((job) => job.kind === 'ack')).toHaveLength(1);
    for (const result of results) {
      if (result.kind !== 'accepted') throw new Error('Expected acceptance');
      expect(jobs.filter((job) => job.contact_id === result.id && job.kind === 'team')).toHaveLength(1);
    }
    expect(jobs.every((job) => job.state === 'queued' && job.attempts === 0)).toBe(true);
  });

  it('uses a rolling 24-hour ack window while still enqueuing every accepted team notification', async () => {
    const repository = new PostgresContactRepository(pool);
    const times = [0, 24 * 60 * 60 - 1, 24 * 60 * 60];
    for (const [index, time] of times.entries()) {
      const clientAddress = `203.0.113.${43 + index}`;
      const challengeToken = await challenge(repository, clientAddress, atSecond(time));
      const result = await submission({
        repository, challengeToken, clientAddress, message: `Question ${index}`,
        enqueueAcknowledgement: true, now: atSecond(time),
      });
      expect(result.kind).toBe('accepted');
    }

    const jobs = await mailJobs();
    expect(jobs.filter((job) => job.kind === 'team')).toHaveLength(3);
    expect(jobs.filter((job) => job.kind === 'ack').map((job) => job.created_at)).toEqual([
      atSecond(0), atSecond(24 * 60 * 60),
    ]);
  });

  it('does not enqueue rejected, duplicate, spam, or non-opted-in acknowledgement jobs', async () => {
    const repository = new PostgresContactRepository(pool);
    const firstAddress = '203.0.113.46';
    const duplicateAddress = '203.0.113.47';
    const firstToken = await challenge(repository, firstAddress, atSecond(0));
    const duplicateToken = await challenge(repository, duplicateAddress, atSecond(0));
    const spamToken = await challenge(repository, '203.0.113.48', atSecond(0));
    const accepted = await submission({
      repository, challengeToken: firstToken, clientAddress: firstAddress, message: 'Shared content', now: atSecond(0),
    });
    expect(accepted.kind).toBe('accepted');
    const rejected = await submission({
      repository, challengeToken: firstToken, clientAddress: firstAddress, message: 'Replay',
      enqueueAcknowledgement: true, now: atSecond(0),
    });
    const duplicate = await submission({
      repository, challengeToken: duplicateToken, clientAddress: duplicateAddress, message: 'Shared content',
      enqueueAcknowledgement: true, now: atSecond(0),
    });
    const spam = await submission({
      repository, challengeToken: spamToken, clientAddress: '203.0.113.48', message: 'Other content',
      website: 'spam trap', enqueueAcknowledgement: true, now: atSecond(0),
    });

    expect([rejected.kind, duplicate.kind, spam.kind]).toEqual(['invalid_challenge', 'duplicate', 'spam']);
    if (accepted.kind !== 'accepted') throw new Error('Expected acceptance');
    expect(await mailJobs()).toEqual([{
      contact_id: accepted.id, kind: 'team', state: 'queued', attempts: 0, created_at: atSecond(0),
    }]);
  });

  it('rolls back the submission and challenge consumption if its job cannot be enqueued', async () => {
    const repository = new PostgresContactRepository(pool);
    const clientAddress = '203.0.113.49';
    const challengeToken = await challenge(repository, clientAddress, atSecond(0));
    await pool.query(`alter table miracon.contact_mail_jobs
      add constraint reject_ack_job_for_atomicity check (kind <> 'ack')`);
    try {
      await expect(submission({
        repository, challengeToken, clientAddress, message: 'Must be atomic',
        enqueueAcknowledgement: true, now: atSecond(0),
      })).rejects.toMatchObject({ code: '23514' });
      await expect(submissionCount()).resolves.toBe(0);
      expect(await mailJobs()).toEqual([]);
    } finally {
      await pool.query('alter table miracon.contact_mail_jobs drop constraint reject_ack_job_for_atomicity');
    }

    const retry = await submission({
      repository, challengeToken, clientAddress, message: 'Must be atomic',
      enqueueAcknowledgement: true, now: atSecond(0),
    });
    expect(retry.kind).toBe('accepted');
    expect((await mailJobs()).map((job) => job.kind)).toEqual(['ack', 'team']);
  });

  it('cascades queued and sent jobs on contact deletion and tolerates legacy null-email contacts', async () => {
    const repository = new PostgresContactRepository(pool);
    const legacyId = randomUUID();
    await pool.query(
      `insert into miracon.contact_submissions
         (id, name, email, phone, message, consented_at, locale, source_path,
          client_digest, duplicate_digest, created_at)
       values ($1, 'Legacy', null, '+302100000000', 'Historical', $2, 'en', '/contact-test', $3, $4, $2)`,
      [legacyId, atSecond(-1), Buffer.alloc(32, 12), Buffer.alloc(32, 13)],
    );
    const clientAddress = '203.0.113.50';
    const challengeToken = await challenge(repository, clientAddress, atSecond(0));
    const result = await submission({
      repository, challengeToken, clientAddress, message: 'Please reply',
      enqueueAcknowledgement: true, now: atSecond(0),
    });
    expect(result.kind).toBe('accepted');
    if (result.kind !== 'accepted') throw new Error('Expected acceptance');
    expect((await mailJobs()).map((job) => job.kind)).toEqual(['ack', 'team']);
    await pool.query(
      `update miracon.contact_mail_jobs set state = 'sent', sent_at = $2
       where contact_id = $1 and kind = 'team'`,
      [result.id, atSecond(0)],
    );

    await pool.query('delete from miracon.contact_submissions where id = $1', [result.id]);
    expect(await mailJobs()).toEqual([]);
    await expect(submissionCount()).resolves.toBe(1);
  });
});

async function challenge(
  repository: PostgresContactRepository,
  clientAddress: string,
  now: Date,
): Promise<ContactChallengeToken> {
  const result = await issueContactChallenge(repository, { clientAddress, digestSecret, now });
  if (result.kind !== 'issued') throw new Error('Expected challenge issuance');
  return result.token;
}

type SubmissionFixture = {
  readonly repository: PostgresContactRepository;
  readonly challengeToken: ContactChallengeToken;
  readonly clientAddress: string;
  readonly message: string;
  readonly email?: string;
  readonly website?: string;
  readonly enqueueAcknowledgement?: boolean;
  readonly now: Date;
};

function submission(fixture: SubmissionFixture) {
  const { repository, challengeToken, clientAddress, message, now } = fixture;
  return submitContact(repository, {
    clientAddress,
    digestSecret,
    now,
    enqueueAcknowledgement: fixture.enqueueAcknowledgement,
    submission: {
      name: 'Ada Lovelace',
      phone: '+30 210 000 0000',
      email: fixture.email ?? 'ada@example.test',
      message,
      consent: true,
      locale: 'en',
      sourcePath: '/contact-test',
      website: fixture.website ?? '',
      challenge: challengeToken,
    },
  });
}

function atSecond(second: number): Date {
  return new Date(Date.parse('2026-09-02T12:00:00.000Z') + second * 1_000);
}

async function submissionCount(): Promise<number> {
  const result = await pool.query<{ readonly count: number }>('select count(*)::integer as count from miracon.contact_submissions');
  return result.rows[0]?.count ?? 0;
}

type MailJobRow = {
  readonly contact_id: string;
  readonly kind: 'ack' | 'team';
  readonly state: 'queued' | 'leased' | 'sent' | 'dead';
  readonly attempts: number;
  readonly created_at: Date;
};

async function mailJobs(): Promise<readonly MailJobRow[]> {
  const result = await pool.query<MailJobRow>(
    `select contact_id::text, kind, state, attempts, created_at
     from miracon.contact_mail_jobs order by created_at, contact_id, kind`,
  );
  return result.rows;
}

function requireSafeDatabaseUrl(): string {
  const value = process.env.DATABASE_TEST_URL;
  const allowed = process.env.DATABASE_TEST_ALLOW_RESET === '1';
  if (!value || !allowed || !/(?:^|[_-])(?:test|testing|ci|disposable|tmp)(?:$|[_-])/iu.test(new URL(value).pathname)) {
    throw new Error('Guarded DATABASE_TEST_URL and DATABASE_TEST_ALLOW_RESET=1 are required');
  }
  return value;
}

import { createHmac } from 'node:crypto';
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
  await pool.query('truncate miracon.contact_submissions, miracon.contact_challenges');
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
      submission({ repository, challengeToken: firstChallenge, clientAddress, message: 'Fifth candidate', now: atSecond(48) }),
      submission({ repository, challengeToken: secondChallenge, clientAddress, message: 'Sixth candidate', now: atSecond(48) }),
    ]);

    // Then
    expect(results.map((result) => result.kind).sort()).toEqual(['accepted', 'rate_limited']);
    await expect(submissionCount()).resolves.toBe(5);
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
  readonly now: Date;
};

function submission(fixture: SubmissionFixture) {
  const { repository, challengeToken, clientAddress, message, now } = fixture;
  return submitContact(repository, {
    clientAddress,
    digestSecret,
    now,
    submission: {
      name: 'Ada Lovelace',
      phone: '+30 210 000 0000',
      email: 'ada@example.test',
      message,
      consent: true,
      locale: 'en',
      sourcePath: '/contact-test',
      website: '',
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

function requireSafeDatabaseUrl(): string {
  const value = process.env.DATABASE_TEST_URL;
  const allowed = process.env.DATABASE_TEST_ALLOW_RESET === '1';
  if (!value || !allowed || !/(?:^|[_-])(?:test|testing|ci|disposable|tmp)(?:$|[_-])/iu.test(new URL(value).pathname)) {
    throw new Error('Guarded DATABASE_TEST_URL and DATABASE_TEST_ALLOW_RESET=1 are required');
  }
  return value;
}

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import pg from 'pg';
import { migrate } from '../scripts/postgres-migrate.mjs';
import { claimContactMailJob, completeContactMailJob } from '../scripts/contact-mail-drain.mjs';
import { requireSafeDatabaseTestUrl, resetSchemas } from '../postgres/tests/database-test-helpers.mjs';

const databaseUrl = requireSafeDatabaseTestUrl();
const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
const now = new Date('2026-09-02T12:00:00.000Z');

before(async () => {
  const client = await pool.connect();
  try {
    await resetSchemas(client, databaseUrl);
  } finally {
    client.release();
  }
  await migrate(databaseUrl);
});

beforeEach(async () => {
  await pool.query('truncate miracon.contact_mail_jobs, miracon.contact_submissions, miracon.contact_challenges');
});

after(async () => {
  await pool.end();
});

async function queueJob(kind = 'team', createdAt = now) {
  const id = randomUUID();
  await pool.query(
    `insert into miracon.contact_submissions
       (id, name, email, phone, message, consented_at, locale, source_path,
        client_digest, duplicate_digest, created_at)
     values ($1, 'Mail Test', 'person@example.test', '+302100000000', 'A real enquiry', $2,
             'en', '/mail-test', $3, $4, $2)`,
    [id, createdAt, randomBytes(32), randomBytes(32)],
  );
  await pool.query(
    `insert into miracon.contact_mail_jobs (contact_id, kind, next_attempt_at, created_at)
     values ($1, $2, $3, $3)`,
    [id, kind, createdAt],
  );
  return id;
}

test('concurrent PostgreSQL workers claim different rows and complete only owned leases', async () => {
  const ids = [await queueJob(), await queueJob()];
  const [first, second] = await Promise.all([
    claimContactMailJob(pool, now), claimContactMailJob(pool, now),
  ]);
  assert.ok(first && second);
  assert.deepEqual(new Set([first.id, second.id]), new Set(ids));
  assert.equal(await claimContactMailJob(pool, now), null);
  assert.equal(await completeContactMailJob(pool, first, now, 'transport_failed'), 'queued');
  assert.equal(await completeContactMailJob(pool, second, now), 'sent');
  const states = await pool.query(
    `select contact_id::text as id, state, attempts, next_attempt_at, sent_at
     from miracon.contact_mail_jobs order by contact_id`,
  );
  assert.equal(states.rows.find((row) => row.id === first.id)?.state, 'queued');
  assert.equal(states.rows.find((row) => row.id === first.id)?.next_attempt_at?.getTime(), now.getTime() + 60_000);
  assert.equal(states.rows.find((row) => row.id === second.id)?.state, 'sent');
  assert.deepEqual(states.rows.map((row) => row.attempts), [1, 1]);
  assert.equal(await claimContactMailJob(pool, new Date(now.getTime() + 59_999)), null);
  const retry = await claimContactMailJob(pool, new Date(now.getTime() + 60_000));
  assert.equal(retry?.id, first.id);
  assert.equal(retry.attempts, 2);
});

test('expired lease is reclaimable but stale worker cannot mark a newer lease sent', async () => {
  const id = await queueJob('ack');
  const stale = await claimContactMailJob(pool, now);
  assert.equal(stale?.id, id);
  const recoveredAt = new Date(now.getTime() + 60_000);
  const recovered = await claimContactMailJob(pool, recoveredAt);
  assert.equal(recovered?.id, id);
  assert.equal(recovered.attempts, 2);
  assert.notEqual(recovered.leaseToken, stale.leaseToken);
  assert.equal(await completeContactMailJob(pool, stale, recoveredAt), 'lease_lost');
  assert.equal(await completeContactMailJob(pool, recovered, recoveredAt), 'sent');
  const result = await pool.query(
    'select state, attempts, sent_at from miracon.contact_mail_jobs where contact_id = $1',
    [id],
  );
  assert.deepEqual(result.rows, [{ state: 'sent', attempts: 2, sent_at: recoveredAt }]);
});

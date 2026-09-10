import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { migrate } from '../scripts/postgres-migrate.mjs';
import { purgeExpiredContacts } from '../scripts/contact-retention-purge.mjs';
import { requireSafeDatabaseTestUrl, resetSchemas } from '../postgres/tests/database-test-helpers.mjs';

const databaseUrl = requireSafeDatabaseTestUrl();
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
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

after(async () => {
  await pool.end();
});

test('retention deletes 91-day contacts but retains 89-day and exact 90-day contacts', async () => {
  // Given
  for (const [id, ageDays] of [[89, 89], [90, 90], [91, 91]]) {
    const createdAt = new Date(now.getTime() - ageDays * 86_400_000);
    await pool.query(
      `insert into miracon.contact_submissions
         (id, name, email, message, consented_at, locale, source_path,
          client_digest, duplicate_digest, created_at)
       values ($1, $2, $3, $4, $5, 'en', '/retention-test', $6, $7, $5)`,
      [`00000000-0000-4000-8000-${String(id).padStart(12, '0')}`, `${ageDays} days`,
        `${ageDays}@example.test`, 'Retention boundary', createdAt, Buffer.alloc(32, id), Buffer.alloc(32, id + 1)],
    );
  }

  // When
  const result = await purgeExpiredContacts(pool, now);
  const retained = await pool.query('select name from miracon.contact_submissions order by created_at');

  // Then
  assert.equal(result.deleted, 1);
  assert.deepEqual(retained.rows, [{ name: '90 days' }, { name: '89 days' }]);
});

test('retention deletes expired challenges but retains the exact expiry boundary', async () => {
  // Given
  await pool.query(
    `insert into miracon.contact_challenges
       (token_digest, client_digest, created_at, not_before, expires_at)
     values
       ($1, $2, $3, $4, $5),
       ($6, $7, $3, $4, $8)`,
    [Buffer.alloc(32, 1), Buffer.alloc(32, 2), new Date(now.getTime() - 10_000),
      new Date(now.getTime() - 5_000), new Date(now.getTime() - 1),
      Buffer.alloc(32, 3), Buffer.alloc(32, 4), now],
  );

  // When
  await purgeExpiredContacts(pool, now);
  const retained = await pool.query('select expires_at from miracon.contact_challenges');

  // Then
  assert.deepEqual(retained.rows, [{ expires_at: now }]);
});

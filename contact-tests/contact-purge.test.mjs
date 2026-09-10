import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTACT_RETENTION_DAYS, purgeExpiredContacts } from '../scripts/contact-retention-purge.mjs';

test('purges contact records at the fixed retention boundary', async () => {
  // Given
  const calls = [];
  const database = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rowCount: 3, rows: [] };
    },
  };
  const now = new Date('2026-09-02T12:00:00.000Z');

  // When
  const result = await purgeExpiredContacts(database, now);

  // Then
  assert.equal(CONTACT_RETENTION_DAYS, 90);
  assert.deepEqual(result, { deleted: 3, cutoff: '2026-06-04T12:00:00.000Z' });
  assert.match(calls[0].sql, /delete from miracon\.contact_submissions/iu);
  assert.deepEqual(calls[0].values, [new Date('2026-06-04T12:00:00.000Z'), now]);
});

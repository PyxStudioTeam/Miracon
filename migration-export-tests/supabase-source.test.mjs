import assert from 'node:assert/strict';
import test from 'node:test';
import { readSupabaseSource } from '../scripts/migration/supabase-source.mjs';

function fakeClient({ pages = {}, settings = { data: { id: 1 }, error: null } }) {
  const calls = [];
  return {
    calls,
    from(table) {
      const query = {
        select(_columns, options) { this.countRequested = options?.count; return this; },
        order(column) { this.orderColumn = column; return this; },
        range(from, to) { calls.push({ table, from, to, order: this.orderColumn, count: this.countRequested }); return Promise.resolve(pages[table]?.shift()); },
        eq(column, value) { this.filter = { column, value }; return this; },
        single() { calls.push({ table, filter: this.filter, single: true }); return Promise.resolve(settings); },
      };
      return query;
    },
  };
}

test('reads stable multi-page tables through the final short page', async () => {
  // Given
  const client = fakeClient({ pages: {
    projects: [{ data: [{ id: 'a' }, { id: 'b' }], count: 3, error: null }, { data: [{ id: 'c' }], count: 3, error: null }],
    project_images: [{ data: [], count: 0, error: null }],
    homepage_videos: [{ data: [{ id: 'v1' }], count: 1, error: null }],
  } });
  // When
  const result = await readSupabaseSource({ client, pageSize: 2 });
  // Then
  assert.deepEqual(result.projects.map(({ id }) => id), ['a', 'b', 'c']);
  assert.deepEqual(client.calls.filter(({ table }) => table === 'projects'), [
    { table: 'projects', from: 0, to: 1, order: 'id', count: 'exact' },
    { table: 'projects', from: 2, to: 3, order: 'id', count: 'exact' },
  ]);
});

test('fails closed when a page has an API error', async () => {
  // Given
  const secret = 'service-role-secret-value';
  const client = fakeClient({ pages: { projects: [{ data: null, count: null, error: { code: '42501', message: secret } }] } });
  // When / Then
  await assert.rejects(readSupabaseSource({ client }), (error) => {
    assert.match(error.message, /projects.*42501/i);
    assert.doesNotMatch(error.message, new RegExp(secret));
    return true;
  });
});

test('rejects duplicate IDs across pages', async () => {
  // Given
  const client = fakeClient({ pages: {
    projects: [{ data: [{ id: 'a' }], count: 2, error: null }, { data: [{ id: 'a' }], count: 2, error: null }, { data: [], count: 2, error: null }],
  } });
  // When / Then
  await assert.rejects(readSupabaseSource({ client, pageSize: 1 }), /duplicate.*projects.*a/i);
});

test('rejects pages that violate stable id order', async () => {
  // Given
  const client = fakeClient({ pages: { projects: [{ data: [{ id: 'b' }, { id: 'a' }], count: 2, error: null }, { data: [], count: 2, error: null }] } });
  // When / Then
  await assert.rejects(readSupabaseSource({ client, pageSize: 2 }), /stable id order/i);
});

test('rejects non-array and incomplete count responses', async () => {
  // Given / When / Then
  await assert.rejects(readSupabaseSource({ client: fakeClient({ pages: { projects: [{ data: {}, count: 0, error: null }] } }) }), /projects.*array/i);
  await assert.rejects(readSupabaseSource({ client: fakeClient({ pages: { projects: [{ data: [], count: 1, error: null }] } }) }), /projects.*count/i);
});

test('requires the site settings singleton to be id 1', async () => {
  // Given
  const empty = [{ data: [], count: 0, error: null }];
  const client = fakeClient({ pages: { projects: [...empty], project_images: [...empty], homepage_videos: [...empty] }, settings: { data: { id: 2 }, error: null } });
  // When / Then
  await assert.rejects(readSupabaseSource({ client }), /site_settings.*id 1/i);
  assert.deepEqual(client.calls.at(-1), { table: 'site_settings', filter: { column: 'id', value: 1 }, single: true });
});

test('enforces the bounded page-size contract', async () => {
  // Given / When / Then
  await assert.rejects(readSupabaseSource({ client: fakeClient({}), pageSize: 0 }), /page size/i);
  await assert.rejects(readSupabaseSource({ client: fakeClient({}), pageSize: 1001 }), /page size/i);
});

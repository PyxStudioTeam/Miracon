import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { migrate } from '../../scripts/postgres-migrate.mjs';
import { openClient, requireSafeDatabaseTestUrl, resetSchemas } from './database-test-helpers.mjs';

const databaseUrl = requireSafeDatabaseTestUrl();
let client;

before(async () => {
  client = await openClient(databaseUrl);
  await resetSchemas(client, databaseUrl);
  await migrate(databaseUrl);
});

after(async () => {
  await client?.end();
});

test('an invalid homepage replacement rolls back every original row and column', async () => {
  // Given
  const beforeReplacement = await client.query(`
    select row_to_json(video) as row from miracon.homepage_videos video order by id
  `);

  // When
  await assert.rejects(client.query('select miracon.replace_homepage_videos($1::jsonb)', [JSON.stringify([{
    id: 'invalid-video', project_id: 'missing', desktop_url: '/media/missing.mp4',
  }])]));
  const afterReplacement = await client.query(`
    select row_to_json(video) as row from miracon.homepage_videos video order by id
  `);

  // Then
  assert.deepEqual(afterReplacement.rows, beforeReplacement.rows);
});

test('two concurrent homepage replacements finish as exactly one complete request', async () => {
  // Given
  const gate = await openClient(databaseUrl, 'homepage-gate');
  const first = await openClient(databaseUrl, 'homepage-replace-first');
  const second = await openClient(databaseUrl, 'homepage-replace-second');
  const firstPlaylist = [
    { id: 'first-a', title: 'First A', desktop_url: '/media/first-a.mp4', sort_order: 0 },
    { id: 'first-b', title: 'First B', desktop_url: '/media/first-b.mp4', sort_order: 1 },
  ];
  const secondPlaylist = [
    { id: 'second-a', title: 'Second A', desktop_url: '/media/second-a.mp4', sort_order: 0 },
    { id: 'second-b', title: 'Second B', desktop_url: '/media/second-b.mp4', sort_order: 1 },
  ];
  await gate.query('begin');
  await gate.query(`select pg_advisory_xact_lock(hashtextextended('miracon.replace_homepage_videos', 0))`);
  let gateOpen = true;
  let replacements = [];

  try {
    // When
    replacements = [
      first.query('select miracon.replace_homepage_videos($1::jsonb)', [JSON.stringify(firstPlaylist)]),
      second.query('select miracon.replace_homepage_videos($1::jsonb)', [JSON.stringify(secondPlaylist)]),
    ];
    let waiting = 0;
    for (let attempt = 0; attempt < 1_000 && waiting < 2; attempt += 1) {
      const result = await gate.query(`
        select count(*)::integer as count
        from pg_stat_activity
        where application_name in ('homepage-replace-first', 'homepage-replace-second')
          and wait_event = 'advisory'
      `);
      waiting = result.rows[0].count;
      if (waiting < 2) await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(waiting, 2);
    await gate.query('commit');
    gateOpen = false;
    await Promise.all(replacements);
    const result = await client.query(`
      select id, title, desktop_url, sort_order
      from miracon.homepage_videos
      order by sort_order
    `);
    const rows = result.rows;
    const expectedFirst = firstPlaylist.map(({ id, title, desktop_url, sort_order }) => ({ id, title, desktop_url, sort_order }));
    const expectedSecond = secondPlaylist.map(({ id, title, desktop_url, sort_order }) => ({ id, title, desktop_url, sort_order }));

    // Then
    assert.ok([JSON.stringify(expectedFirst), JSON.stringify(expectedSecond)].includes(JSON.stringify(rows)));
  } finally {
    if (gateOpen) await gate.query('rollback');
    await Promise.allSettled(replacements);
    await Promise.all([gate.end(), first.end(), second.end()]);
  }
});

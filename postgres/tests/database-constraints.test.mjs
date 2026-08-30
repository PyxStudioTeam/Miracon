import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { migrate } from '../../scripts/postgres-migrate.mjs';
import { openClient, requireSafeDatabaseTestUrl, resetSchemas } from './database-test-helpers.mjs';

const databaseUrl = requireSafeDatabaseTestUrl();
const validHash = '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$Y2hlY2s';
let client;

before(async () => {
  client = await openClient(databaseUrl);
  await resetSchemas(client, databaseUrl);
  await migrate(databaseUrl);
});

after(async () => {
  await client?.end();
});

test('rejects a malformed Argon2id password hash before any admin exists', async () => {
  // Given / When / Then
  await assert.rejects(client.query(`
    insert into miracon.admin_users (id, email, password_hash)
    values (2, 'admin@miracon.local', '$argon2id$invalid')
  `));
});

test('accepts a structurally valid Argon2id password hash', async () => {
  // Given / When
  await client.query('insert into miracon.admin_users (id, email, password_hash, role) values (1, $1, $2, $3)', [
    'admin@miracon.local', validHash, 'owner',
  ]);
  const result = await client.query('select password_hash, role::text from miracon.admin_users where id = 1');

  // Then
  assert.equal(result.rows[0].password_hash, validHash);
  assert.equal(result.rows[0].role, 'owner');
});

test('accepts an editor while preserving the smallint administrator identifier', async () => {
  // Given / When
  const result = await client.query('insert into miracon.admin_users (email, password_hash) values ($1, $2) returning id, pg_typeof(id)::text as id_type, role::text', [
    'editor@miracon.local', validHash,
  ]);

  // Then
  assert.deepEqual(result.rows[0], { id: 2, id_type: 'smallint', role: 'editor' });
});

test('allocates distinct editor identifiers across concurrent inserts', async () => {
  // Given
  const secondClient = await openClient(databaseUrl, 'concurrent-admin-id-test');

  try {
    // When
    const results = await Promise.all([
      client.query('insert into miracon.admin_users (email, password_hash) values ($1, $2) returning id, role::text', [
        'editor-two@miracon.local', validHash,
      ]),
      secondClient.query('insert into miracon.admin_users (email, password_hash) values ($1, $2) returning id, role::text', [
        'editor-three@miracon.local', validHash,
      ]),
    ]);

    // Then
    assert.deepEqual(results.flatMap((result) => result.rows).sort((left, right) => left.id - right.id), [
      { id: 3, role: 'editor' },
      { id: 4, role: 'editor' },
    ]);
  } finally {
    await secondClient.end();
  }
});

test('rejects a second owner and an editor identity at id one', async () => {
  // Given / When / Then
  await assert.rejects(client.query(`
    insert into miracon.admin_users (id, email, password_hash, role)
    values (5, 'second-owner@miracon.local', $1, 'owner')
  `, [validHash]), { code: '23514' });
  await assert.rejects(client.query(`
    update miracon.admin_users set role = 'editor' where id = 1
  `), { code: '23514' });
});

test('rejects an administrator role outside owner and editor', async () => {
  // Given / When / Then
  await assert.rejects(client.query(`
    insert into miracon.admin_users (id, email, password_hash, role)
    values (3, 'invalid-role@miracon.local', $1, 'reviewer')
  `, [validHash]), { code: '22P02' });
});

test('rejects negative project availability', async () => {
  // Given / When / Then
  await assert.rejects(client.query(`
    insert into miracon.projects (id, slug, title, remaining_units)
    values ('negative-availability', 'negative-availability', 'Negative availability', -1)
  `), { code: '23514', constraint: 'projects_remaining_units_check' });
});

test('rejects a session token hash that is not 32 bytes', async () => {
  // Given / When / Then
  await assert.rejects(client.query(`
    insert into miracon.admin_sessions
      (id, admin_user_id, session_token_hash, csrf_token_hash, expires_at)
    values ('bad-token', 1, decode('01', 'hex'), decode(repeat('02', 32), 'hex'), now() + interval '1 hour')
  `), { code: '23514' });
});

test('rejects a CSRF token hash that is not 32 bytes', async () => {
  // Given / When / Then
  await assert.rejects(client.query(`
    insert into miracon.admin_sessions
      (id, admin_user_id, session_token_hash, csrf_token_hash, expires_at)
    values ('bad-csrf', 1, decode(repeat('01', 32), 'hex'), decode('02', 'hex'), now() + interval '1 hour')
  `));
});

test('rejects a session that expires before it is created', async () => {
  // Given / When / Then
  await assert.rejects(client.query(`
    insert into miracon.admin_sessions
      (id, admin_user_id, session_token_hash, csrf_token_hash, expires_at)
    values ('expired', 1, decode(repeat('03', 32), 'hex'), decode(repeat('04', 32), 'hex'), now() - interval '1 hour')
  `));
});

test('stores a valid session and makes revocation observable', async () => {
  // Given
  await client.query(`
    insert into miracon.admin_sessions
      (id, admin_user_id, session_token_hash, csrf_token_hash, expires_at)
    values ('session-one', 1, decode(repeat('05', 32), 'hex'), decode(repeat('06', 32), 'hex'), now() + interval '1 hour')
  `);

  // When
  await client.query(`update miracon.admin_sessions set revoked_at = now() where id = 'session-one'`);
  const result = await client.query(`select revoked_at is not null as revoked from miracon.admin_sessions where id = 'session-one'`);

  // Then
  assert.equal(result.rows[0].revoked, true);
});

test('rejects an absolute media URL while the relative path is valid', async () => {
  // Given / When / Then
  await assert.rejects(client.query(`
    insert into miracon.media_files (id, relative_url, relative_path, mime_type, size_bytes, sha256)
    values ('bad-url', 'https://example.com/image.webp', 'projects/image.webp', 'image/webp', 100, decode(repeat('07', 32), 'hex'))
  `));
});

test('rejects path traversal while the relative URL is valid', async () => {
  // Given / When / Then
  await assert.rejects(client.query(`
    insert into miracon.media_files (id, relative_url, relative_path, mime_type, size_bytes, sha256)
    values ('bad-path', '/media/projects/image.webp', '../image.webp', 'image/webp', 100, decode(repeat('08', 32), 'hex'))
  `));
});

test('accepts a same-domain media URL with a traversal-free relative path', async () => {
  // Given / When
  await client.query(`
    insert into miracon.media_files (id, relative_url, relative_path, mime_type, size_bytes, sha256)
    values ('valid-media', '/media/projects/image.webp', 'projects/image.webp', 'image/webp', 100, decode(repeat('09', 32), 'hex'))
  `);
  const result = await client.query(`select relative_url, relative_path from miracon.media_files where id = 'valid-media'`);

  // Then
  assert.deepEqual(result.rows[0], {
    relative_url: '/media/projects/image.webp',
    relative_path: 'projects/image.webp',
  });
});

test('requires a legal-document URL before making it visible', async () => {
  // Given / When / Then
  await assert.rejects(client.query(`update miracon.site_settings set footer_terms_visible = true where id = 1`));
});

test('rejects invalid revision state and action combinations', async () => {
  // Given / When / Then
  await assert.rejects(client.query(`
    insert into miracon.content_revisions
      (id, aggregate_type, aggregate_id, revision_number, state, action, snapshot, expected_revision_id, created_by)
    select
      '10000000-0000-0000-0000-000000000001',
      'homepage_hero',
      'singleton',
      2,
      'pending',
      'publish',
      '{"aggregateType":"homepage_hero","aggregateId":"singleton","videos":[]}'::jsonb,
      current_revision_id,
      1
    from miracon.content_revision_heads
    where aggregate_type = 'homepage_hero' and aggregate_id = 'singleton'
  `), { code: '23514' });
});

test('rejects malformed complete project snapshots with a stable check violation', async () => {
  // Given / When / Then
  await assert.rejects(client.query(`
    insert into miracon.content_revisions
      (id, aggregate_type, aggregate_id, revision_number, state, action, snapshot, created_by)
    values (
      '10000000-0000-0000-0000-000000000002',
      'project',
      'new-project',
      1,
      'pending',
      'proposal',
      '{"aggregateType":"project","aggregateId":"new-project","deleted":"false","project":{},"images":[]}'::jsonb,
      2
    )
  `), { code: '23514' });
});

test('rejects extra snapshot keys and cross-aggregate nested identities', async () => {
  // Given
  await client.query(`
    insert into miracon.projects (id, slug, title)
    values
      ('identity-source-project', 'identity-source-project', 'Identity source project'),
      ('identity-other-project', 'identity-other-project', 'Identity other project')
  `);
  await client.query(`
    insert into miracon.project_images (id, project_id, url, role)
    values ('identity-source-image', 'identity-source-project', '/media/identity-source.webp', 'gallery')
  `);

  // When / Then
  await assert.rejects(client.query(`
    insert into miracon.content_revisions
      (id, aggregate_type, aggregate_id, revision_number, state, action, snapshot, expected_revision_id, created_by)
    select
      '10000000-0000-0000-0000-000000000003',
      'homepage_hero',
      'singleton',
      3,
      'pending',
      'proposal',
      '{"aggregateType":"homepage_hero","aggregateId":"singleton","videos":[],"extra":true}'::jsonb,
      current_revision_id,
      2
    from miracon.content_revision_heads
    where aggregate_type = 'homepage_hero' and aggregate_id = 'singleton'
  `), { code: '23514' });
  await assert.rejects(client.query(`
    insert into miracon.content_revisions
      (id, aggregate_type, aggregate_id, revision_number, state, action, snapshot, created_by)
    select
      '10000000-0000-0000-0000-000000000004',
      'project',
      source_project.id,
      1,
      'pending',
      'proposal',
      jsonb_build_object(
        'aggregateType', 'project',
        'aggregateId', source_project.id,
        'deleted', false,
        'project', to_jsonb(source_project) || jsonb_build_object('id', other_project.id),
        'images', jsonb_build_array(
          to_jsonb(source_image) || jsonb_build_object('project_id', other_project.id)
        )
      ),
      2
    from miracon.projects as source_project
    join miracon.project_images as source_image on source_image.project_id = source_project.id
    cross join miracon.projects as other_project
    where source_project.id = 'identity-source-project'
      and other_project.id = 'identity-other-project'
  `), { code: '23514' });
});

test('rejects nullable, mistyped, and cross-aggregate snapshot identities independently', async () => {
  // Given
  await client.query(`
    insert into miracon.projects (id, slug, title)
    values
      ('7', 'identity-total-seven', 'Identity total seven'),
      ('8', 'identity-total-eight', 'Identity total eight')
  `);
  await client.query(`
    insert into miracon.project_images (id, project_id, url, role)
    values ('identity-total-image', '7', '/media/identity-total.webp', 'gallery')
  `);
  const fixtures = await client.query(`
    select
      jsonb_build_object(
        'aggregateType', 'project',
        'aggregateId', project.id,
        'deleted', false,
        'project', to_jsonb(project),
        'images', jsonb_build_array(to_jsonb(image))
      ) as project_snapshot,
      jsonb_build_object(
        'aggregateType', 'site_settings',
        'aggregateId', 'singleton',
        'settings', to_jsonb(settings)
      ) as settings_snapshot
    from miracon.projects as project
    join miracon.project_images as image on image.project_id = project.id
    cross join miracon.site_settings as settings
    where project.id = '7'
  `);
  const projectSnapshot = fixtures.rows[0].project_snapshot;
  const settingsSnapshot = fixtures.rows[0].settings_snapshot;
  const cases = [
    {
      aggregateId: '7',
      aggregateType: 'project',
      id: '40000000-0000-0000-0000-000000000001',
      snapshot: { ...projectSnapshot, aggregateType: null },
    },
    {
      aggregateId: '7',
      aggregateType: 'project',
      id: '40000000-0000-0000-0000-000000000002',
      snapshot: { ...projectSnapshot, aggregateType: 7 },
    },
    {
      aggregateId: '7',
      aggregateType: 'project',
      id: '40000000-0000-0000-0000-000000000003',
      snapshot: { ...projectSnapshot, aggregateId: null },
    },
    {
      aggregateId: '7',
      aggregateType: 'project',
      id: '40000000-0000-0000-0000-000000000004',
      snapshot: { ...projectSnapshot, aggregateId: 7 },
    },
    {
      aggregateId: '7',
      aggregateType: 'project',
      id: '40000000-0000-0000-0000-000000000005',
      snapshot: { ...projectSnapshot, project: { ...projectSnapshot.project, id: null } },
    },
    {
      aggregateId: '7',
      aggregateType: 'project',
      id: '40000000-0000-0000-0000-000000000006',
      snapshot: { ...projectSnapshot, project: { ...projectSnapshot.project, id: 7 } },
    },
    {
      aggregateId: '7',
      aggregateType: 'project',
      id: '40000000-0000-0000-0000-000000000007',
      snapshot: { ...projectSnapshot, project: { ...projectSnapshot.project, id: '8' } },
    },
    {
      aggregateId: '7',
      aggregateType: 'project',
      id: '40000000-0000-0000-0000-000000000008',
      snapshot: {
        ...projectSnapshot,
        images: [{ ...projectSnapshot.images[0], project_id: null }],
      },
    },
    {
      aggregateId: '7',
      aggregateType: 'project',
      id: '40000000-0000-0000-0000-000000000009',
      snapshot: {
        ...projectSnapshot,
        images: [{ ...projectSnapshot.images[0], project_id: 7 }],
      },
    },
    {
      aggregateId: '7',
      aggregateType: 'project',
      id: '40000000-0000-0000-0000-000000000010',
      snapshot: {
        ...projectSnapshot,
        images: [{ ...projectSnapshot.images[0], project_id: '8' }],
      },
    },
    {
      aggregateId: 'singleton',
      aggregateType: 'site_settings',
      id: '40000000-0000-0000-0000-000000000011',
      snapshot: { ...settingsSnapshot, settings: { ...settingsSnapshot.settings, id: null } },
    },
    {
      aggregateId: 'singleton',
      aggregateType: 'site_settings',
      id: '40000000-0000-0000-0000-000000000012',
      snapshot: { ...settingsSnapshot, settings: { ...settingsSnapshot.settings, id: '1' } },
    },
    {
      aggregateId: 'singleton',
      aggregateType: 'site_settings',
      id: '40000000-0000-0000-0000-000000000013',
      snapshot: { ...settingsSnapshot, settings: { ...settingsSnapshot.settings, id: 2 } },
    },
  ];

  // When / Then
  for (const identityCase of cases) {
    await assert.rejects(client.query(`
      insert into miracon.content_revisions
        (id, aggregate_type, aggregate_id, revision_number, state, action, snapshot, created_by)
      values ($1, $2, $3, 2, 'pending', 'proposal', $4::jsonb, 2)
    `, [
      identityCase.id,
      identityCase.aggregateType,
      identityCase.aggregateId,
      JSON.stringify(identityCase.snapshot),
    ]), { code: '23514' }, identityCase.id);
  }
});

test('rejects incomplete and extra-key nested snapshot rows', async () => {
  // Given
  await client.query(`
    insert into miracon.projects (id, slug, title)
    values ('snapshot-shape-project', 'snapshot-shape-project', 'Snapshot shape project')
  `);
  await client.query(`
    insert into miracon.project_images (id, project_id, url, role)
    values ('snapshot-shape-image', 'snapshot-shape-project', '/media/snapshot-shape.webp', 'gallery')
  `);

  // When
  const result = await client.query(`
    select
      miracon.is_valid_content_snapshot(
        'project',
        project.id,
        jsonb_build_object(
          'aggregateType', 'project',
          'aggregateId', project.id,
          'deleted', false,
          'project', jsonb_build_object('id', project.id),
          'images', '[]'::jsonb
        )
      ) as incomplete_project,
      miracon.is_valid_content_snapshot(
        'project',
        project.id,
        jsonb_build_object(
          'aggregateType', 'project',
          'aggregateId', project.id,
          'deleted', false,
          'project', to_jsonb(project) || '{"extra":true}'::jsonb,
          'images', '[]'::jsonb
        )
      ) as extra_project,
      miracon.is_valid_content_snapshot(
        'project',
        project.id,
        jsonb_build_object(
          'aggregateType', 'project',
          'aggregateId', project.id,
          'deleted', false,
          'project', to_jsonb(project),
          'images', jsonb_build_array(to_jsonb(image) - 'url')
        )
      ) as incomplete_image,
      miracon.is_valid_content_snapshot(
        'project',
        project.id,
        jsonb_build_object(
          'aggregateType', 'project',
          'aggregateId', project.id,
          'deleted', false,
          'project', to_jsonb(project),
          'images', jsonb_build_array(to_jsonb(image) || '{"extra":true}'::jsonb)
        )
      ) as extra_image,
      miracon.is_valid_content_snapshot(
        'homepage_hero',
        'singleton',
        jsonb_build_object(
          'aggregateType', 'homepage_hero',
          'aggregateId', 'singleton',
          'videos', jsonb_build_array(to_jsonb(video) - 'title')
        )
      ) as incomplete_video,
      miracon.is_valid_content_snapshot(
        'homepage_hero',
        'singleton',
        jsonb_build_object(
          'aggregateType', 'homepage_hero',
          'aggregateId', 'singleton',
          'videos', jsonb_build_array(to_jsonb(video) || '{"extra":true}'::jsonb)
        )
      ) as extra_video,
      miracon.is_valid_content_snapshot(
        'site_settings',
        'singleton',
        jsonb_build_object(
          'aggregateType', 'site_settings',
          'aggregateId', 'singleton',
          'settings', jsonb_build_object('id', settings.id)
        )
      ) as incomplete_settings,
      miracon.is_valid_content_snapshot(
        'site_settings',
        'singleton',
        jsonb_build_object(
          'aggregateType', 'site_settings',
          'aggregateId', 'singleton',
          'settings', to_jsonb(settings) || '{"extra":true}'::jsonb
        )
      ) as extra_settings
    from miracon.projects as project
    join miracon.project_images as image on image.project_id = project.id
    cross join lateral (
      select * from miracon.homepage_videos order by sort_order, id limit 1
    ) as video
    cross join miracon.site_settings as settings
    where project.id = 'snapshot-shape-project'
  `);

  // Then
  assert.deepEqual(result.rows[0], {
    incomplete_project: false,
    extra_project: false,
    incomplete_image: false,
    extra_image: false,
    incomplete_video: false,
    extra_video: false,
    incomplete_settings: false,
    extra_settings: false,
  });
});

test('allows a later-numbered approved revision to establish a previously absent head', async () => {
  // Given
  await client.query(`
    insert into miracon.content_revisions
      (id, aggregate_type, aggregate_id, revision_number, state, action, snapshot, created_by, approved_by, approved_at)
    values (
      '10000000-0000-0000-0000-000000000005',
      'project',
      'later-project',
      7,
      'approved',
      'proposal',
      '{"aggregateType":"project","aggregateId":"later-project","deleted":true,"project":null,"images":[]}'::jsonb,
      2,
      1,
      now()
    )
  `);

  // When
  await client.query(`
    insert into miracon.content_revision_heads
      (aggregate_type, aggregate_id, current_revision_id, current_revision_number)
    values ('project', 'later-project', '10000000-0000-0000-0000-000000000005', 7)
  `);
  const result = await client.query(`
    select current_revision_number::integer
    from miracon.content_revision_heads
    where aggregate_type = 'project' and aggregate_id = 'later-project'
  `);

  // Then
  assert.equal(result.rows[0].current_revision_number, 7);
});

test('allows one valid proposal transition while keeping its complete snapshot immutable', async () => {
  // Given
  await client.query(`
    insert into miracon.content_revisions
      (id, aggregate_type, aggregate_id, revision_number, state, action, snapshot, expected_revision_id, created_by)
    select
      '20000000-0000-0000-0000-000000000001',
      'homepage_hero',
      'singleton',
      2,
      'pending',
      'proposal',
      '{"aggregateType":"homepage_hero","aggregateId":"singleton","videos":[]}'::jsonb,
      current_revision_id,
      2
    from miracon.content_revision_heads
    where aggregate_type = 'homepage_hero' and aggregate_id = 'singleton'
  `);

  // When / Then
  await assert.rejects(client.query(`
    update miracon.content_revisions
    set snapshot = snapshot || '{"tampered":true}'::jsonb
    where id = '20000000-0000-0000-0000-000000000001'
  `), { code: '55000' });
  await assert.rejects(client.query(`
    update miracon.content_revision_heads
    set current_revision_id = '20000000-0000-0000-0000-000000000001', current_revision_number = 2
    where aggregate_type = 'homepage_hero' and aggregate_id = 'singleton'
  `), { code: '23514' });
  await client.query(`
    update miracon.content_revisions
    set state = 'approved', approved_by = 1, approved_at = now()
    where id = '20000000-0000-0000-0000-000000000001'
  `);
  await client.query(`
    update miracon.content_revision_heads
    set current_revision_id = '20000000-0000-0000-0000-000000000001', current_revision_number = 2
    where aggregate_type = 'homepage_hero' and aggregate_id = 'singleton'
  `);
  await assert.rejects(client.query(`
    update miracon.content_revisions
    set state = 'rejected', approved_by = null, approved_at = null
    where id = '20000000-0000-0000-0000-000000000001'
  `), { code: '55000' });
  await assert.rejects(client.query(`
    delete from miracon.content_revisions
    where id = '20000000-0000-0000-0000-000000000001'
  `), { code: '55000' });
});

test('rejects backward and stale revision-head transitions', async () => {
  // Given
  await client.query(`
    insert into miracon.content_revisions
      (id, aggregate_type, aggregate_id, revision_number, state, action, snapshot, expected_revision_id, created_by, approved_by, approved_at)
    select
      '20000000-0000-0000-0000-000000000003',
      'homepage_hero',
      'singleton',
      3,
      'approved',
      'proposal',
      '{"aggregateType":"homepage_hero","aggregateId":"singleton","videos":[]}'::jsonb,
      current_revision_id,
      2,
      1,
      now()
    from miracon.content_revision_heads
    where aggregate_type = 'homepage_hero' and aggregate_id = 'singleton'
  `);
  await client.query(`
    insert into miracon.content_revisions
      (id, aggregate_type, aggregate_id, revision_number, state, action, snapshot, expected_revision_id, created_by, approved_by, approved_at)
    select
      '20000000-0000-0000-0000-000000000004',
      revision.aggregate_type,
      revision.aggregate_id,
      4,
      'approved',
      'proposal',
      revision.snapshot,
      baseline.id,
      2,
      1,
      now()
    from miracon.content_revisions as revision
    join miracon.content_revisions as baseline
      on baseline.aggregate_type = revision.aggregate_type
      and baseline.aggregate_id = revision.aggregate_id
      and baseline.action = 'baseline'
    where revision.id = '20000000-0000-0000-0000-000000000003'
  `);

  // When / Then
  await assert.rejects(client.query(`
    update miracon.content_revision_heads
    set current_revision_id = '20000000-0000-0000-0000-000000000004', current_revision_number = 4
    where aggregate_type = 'homepage_hero' and aggregate_id = 'singleton'
  `), { code: '55000' });
  await assert.rejects(client.query(`
    update miracon.content_revision_heads
    set current_revision_id = md5('miracon:baseline:homepage_hero:singleton')::uuid, current_revision_number = 1
    where aggregate_type = 'homepage_hero' and aggregate_id = 'singleton'
  `), { code: '55000' });
  await assert.rejects(client.query(`
    delete from miracon.content_revision_heads
    where aggregate_type = 'homepage_hero' and aggregate_id = 'singleton'
  `), { code: '55000' });
});

test('rejects truncation of revision heads without losing current heads', async () => {
  // Given
  await client.query('begin');

  try {
    // When / Then
    await assert.rejects(client.query('truncate table miracon.content_revision_heads'), { code: '55000' });
  } finally {
    await client.query('rollback');
  }
});

test('rejects updates and deletes from append-only audit history', async () => {
  // Given
  await client.query(`
    insert into miracon.audit_events
      (id, actor_id, aggregate_type, aggregate_id, revision_id, action, before_snapshot, after_snapshot)
    select
      '30000000-0000-0000-0000-000000000001',
      1,
      revision.aggregate_type,
      revision.aggregate_id,
      revision.id,
      'approve',
      head_revision.snapshot,
      revision.snapshot
    from miracon.content_revisions as revision
    join miracon.content_revision_heads as head
      on head.aggregate_type = revision.aggregate_type and head.aggregate_id = revision.aggregate_id
    join miracon.content_revisions as head_revision on head_revision.id = head.current_revision_id
    where revision.id = '20000000-0000-0000-0000-000000000001'
  `);

  // When / Then
  await assert.rejects(client.query(`
    update miracon.audit_events
    set action = 'publish'
    where id = '30000000-0000-0000-0000-000000000001'
  `), { code: '55000' });
  await assert.rejects(client.query(`
    delete from miracon.audit_events
    where id = '30000000-0000-0000-0000-000000000001'
  `), { code: '55000' });
  await assert.rejects(client.query('truncate table miracon.audit_events'), { code: '55000' });
});

test('rejects every mutation of revision-media history and revision truncation', async () => {
  // Given
  await client.query(`
    insert into miracon.revision_media (revision_id, media_file_id)
    values (md5('miracon:baseline:homepage_hero:singleton')::uuid, 'valid-media')
  `);

  // When / Then
  await assert.rejects(client.query(`
    update miracon.revision_media set created_at = created_at + interval '1 second'
  `), { code: '55000' });
  await assert.rejects(client.query('delete from miracon.revision_media'), { code: '55000' });
  await assert.rejects(client.query('truncate table miracon.revision_media'), { code: '55000' });
  await assert.rejects(client.query('truncate table miracon.content_revisions cascade'), { code: '55000' });
});

test('clean migration baselines retain populated homepage and settings singleton state', async () => {
  // Given / When
  const result = await client.query(`
    select aggregate_type::text, snapshot
    from miracon.content_revisions
    where action = 'baseline' and aggregate_type in ('homepage_hero', 'site_settings')
    order by aggregate_type
  `);
  const homepage = result.rows.find((row) => row.aggregate_type === 'homepage_hero');
  const settings = result.rows.find((row) => row.aggregate_type === 'site_settings');

  // Then
  assert.deepEqual(homepage.snapshot.videos.map((video) => video.id), [
    'default-home-hero', 'home-hero-02',
  ]);
  assert.equal(settings.snapshot.settings.id, 1);
  assert.equal(settings.snapshot.settings.footer_terms_visible, false);
});

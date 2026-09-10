import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';
import { migrate } from '../../scripts/postgres-migrate.mjs';
import { openClient, requireSafeDatabaseTestUrl, resetSchemas } from './database-test-helpers.mjs';

const databaseUrl = requireSafeDatabaseTestUrl();
const migrationsDirectory = new URL('../migrations/', import.meta.url);
const currentMigrationFilenames = [
  '0001_content_tables.sql',
  '0002_admin_sessions_media.sql',
  '0003_project_operations.sql',
  '0004_ordering_and_homepage_operations.sql',
  '0005_login_throttle_cleanup.sql',
  '0006_tighten_admin_password_hash.sql',
  '0007_media_cleanup_pending.sql',
];
const validHash = '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$Y2hlY2s';
const images = [{
  id: 'image-one', url: '/media/image.webp', storage_path: 'projects/image.webp',
  alt: 'Image', role: 'gallery', sort_order: 0, width: 1200, height: 800,
}];
const draft = {
  id: 'project-one', slug: 'project-one', title: 'Draft project', status: 'draft',
  categories: ['coastal'], hero_videos: [{ id: 'hero-1', desktopUrl: '/media/hero.mp4' }],
  walkthrough_videos: [],
  translations: {
    de: { title: 'German title' },
    el: { title: 'Greek title', seoTitle: 'Old Greek SEO' },
  },
};
let client;
let currentMigrationDirectory;
let publishedAt;

before(async () => {
  client = await openClient(databaseUrl);
  await resetSchemas(client, databaseUrl);
  currentMigrationDirectory = await mkdtemp(join(tmpdir(), 'miracon-current-migrations-'));
  await Promise.all(currentMigrationFilenames.map((filename) => copyFile(
    new URL(filename, migrationsDirectory),
    join(currentMigrationDirectory, filename),
  )));
  await migrate(databaseUrl, pathToFileURL(`${currentMigrationDirectory}${sep}`));
  await client.query('insert into miracon.admin_users (id, email, password_hash) values (1, $1, $2)', [
    'owner@miracon.local', validHash,
  ]);
  await client.query(`
    insert into miracon.admin_sessions
      (id, admin_user_id, session_token_hash, csrf_token_hash, expires_at)
    values ('legacy-session', 1, decode(repeat('01', 32), 'hex'), decode(repeat('02', 32), 'hex'), now() + interval '1 hour')
  `);
  await client.query(`
    insert into miracon.media_files
      (id, relative_url, relative_path, mime_type, size_bytes, sha256, uploaded_by)
    values
      ('legacy-media', '/media/projects/legacy.webp', 'projects/legacy.webp', 'image/webp', 100,
        decode(repeat('03', 32), 'hex'), 1),
      ('legacy-media-two', '/media/projects/legacy-two.webp', 'projects/legacy-two.webp', 'image/webp', 200,
        decode(repeat('04', 32), 'hex'), 1)
  `);
  await client.query('select miracon.save_project_with_images($1::jsonb, $2::jsonb)', [{
    id: 'legacy-project', slug: 'legacy-project', title: 'Legacy project', status: 'draft',
  }, JSON.stringify([{
    id: 'legacy-image', url: '/media/projects/legacy.webp', storage_path: 'projects/legacy.webp',
    role: 'gallery', sort_order: 0,
  }, {
    id: 'legacy-image-two', url: '/media/projects/legacy-two.webp', storage_path: 'projects/legacy-two.webp',
    role: 'gallery', sort_order: 1,
  }])]);
  await client.query('select miracon.save_project_with_images($1::jsonb)', [{
    id: 'legacy-project-two', slug: 'legacy-project-two', title: 'Second legacy project', status: 'published',
  }]);
  await client.query(`select miracon.replace_homepage_videos('[]'::jsonb)`);
  await client.query(`
    update miracon.site_settings
    set footer_terms_pdf_url = 'https://example.com/terms.pdf'
    where id = 1
  `);
  await migrate(databaseUrl);
  await migrate(databaseUrl);
});

after(async () => {
  await client?.end();
  if (currentMigrationDirectory) {
    await rm(currentMigrationDirectory, { recursive: true, force: true });
  }
});

test('repeat application leaves one complete migration ledger', async () => {
  // Given / When
  const applied = await client.query('select filename from miracon_meta.schema_migrations order by filename');

  // Then
  assert.deepEqual(applied.rows.map((row) => row.filename), [
    '0001_content_tables.sql',
    '0002_admin_sessions_media.sql',
    '0003_project_operations.sql',
    '0004_ordering_and_homepage_operations.sql',
    '0005_login_throttle_cleanup.sql',
    '0006_tighten_admin_password_hash.sql',
    '0007_media_cleanup_pending.sql',
    '0008_admin_governance_and_availability.sql',
    '0009_exact_revision_materialization.sql',
    '0010_contact_intake.sql',
  ]);
});

test('migrates the existing owner and foreign-key references without changing their identifiers', async () => {
  // Given / When
  const result = await client.query(`
    select
      (select role::text from miracon.admin_users where id = 1) as role,
      (select admin_user_id from miracon.admin_sessions where id = 'legacy-session') as session_owner,
      (select uploaded_by from miracon.media_files where id = 'legacy-media') as media_owner
  `);

  // Then
  assert.deepEqual(result.rows[0], { role: 'owner', session_owner: 1, media_owner: 1 });
});

test('seeds complete deterministic baseline revisions and heads for every governed aggregate', async () => {
  // Given / When
  const revisions = await client.query(`
    select
      revision.aggregate_type::text as aggregate_type,
      revision.aggregate_id,
      revision.id::text,
      revision.revision_number::integer,
      revision.state::text,
      revision.action::text,
      revision.snapshot,
      head.current_revision_id = revision.id as is_head
    from miracon.content_revisions as revision
    join miracon.content_revision_heads as head
      using (aggregate_type, aggregate_id)
    order by revision.aggregate_type, revision.aggregate_id
  `);
  const project = revisions.rows.find((row) => row.aggregate_id === 'legacy-project');
  const secondProject = revisions.rows.find((row) => row.aggregate_id === 'legacy-project-two');
  const homepage = revisions.rows.find((row) => row.aggregate_type === 'homepage_hero');
  const settings = revisions.rows.find((row) => row.aggregate_type === 'site_settings');
  const deterministicProjectId = await client.query(`select md5('miracon:baseline:project:legacy-project')::uuid::text as id`);

  // Then
  assert.equal(revisions.rows.length, 4);
  assert.equal(project.id, deterministicProjectId.rows[0].id);
  assert.deepEqual(project.snapshot.aggregateType, 'project');
  assert.equal(project.snapshot.aggregateId, 'legacy-project');
  assert.equal(project.snapshot.deleted, false);
  assert.equal(project.snapshot.project.remaining_units, null);
  assert.deepEqual(project.snapshot.images.map((image) => image.id), ['legacy-image', 'legacy-image-two']);
  assert.equal(secondProject.snapshot.project.id, 'legacy-project-two');
  assert.deepEqual(secondProject.snapshot.images, []);
  assert.deepEqual(homepage.snapshot, {
    aggregateType: 'homepage_hero', aggregateId: 'singleton', videos: [],
  });
  assert.equal(settings.snapshot.aggregateType, 'site_settings');
  assert.equal(settings.snapshot.aggregateId, 'singleton');
  assert.equal(settings.snapshot.settings.id, 1);
  assert.equal(settings.snapshot.settings.footer_terms_pdf_url, 'https://example.com/terms.pdf');
  for (const revision of revisions.rows) {
    assert.equal(revision.revision_number, 1);
    assert.equal(revision.state, 'approved');
    assert.equal(revision.action, 'baseline');
    assert.equal(revision.is_head, true);
  }
});

test('baseline snapshots exactly equal the locked source rows', async () => {
  // Given / When
  const result = await client.query(`
    select
      not exists (
        select 1
        from miracon.content_revisions as revision
        join miracon.projects as project on project.id = revision.aggregate_id
        where revision.aggregate_type = 'project'
          and revision.action = 'baseline'
          and revision.snapshot <> jsonb_build_object(
            'aggregateType', 'project',
            'aggregateId', project.id,
            'deleted', false,
            'project', to_jsonb(project),
            'images', coalesce((
              select jsonb_agg(to_jsonb(image) order by image.role, image.sort_order, image.id)
              from miracon.project_images as image
              where image.project_id = project.id
            ), '[]'::jsonb)
          )
      ) as projects_match,
      (select snapshot from miracon.content_revisions where aggregate_type = 'homepage_hero' and action = 'baseline')
        = jsonb_build_object(
          'aggregateType', 'homepage_hero',
          'aggregateId', 'singleton',
          'videos', coalesce((
            select jsonb_agg(to_jsonb(video) order by video.sort_order, video.id)
            from miracon.homepage_videos as video
          ), '[]'::jsonb)
        ) as homepage_matches,
      (select snapshot from miracon.content_revisions where aggregate_type = 'site_settings' and action = 'baseline')
        = (select jsonb_build_object(
          'aggregateType', 'site_settings',
          'aggregateId', 'singleton',
          'settings', to_jsonb(settings)
        ) from miracon.site_settings as settings where settings.id = 1) as settings_match
  `);

  // Then
  assert.deepEqual(result.rows[0], {
    projects_match: true,
    homepage_matches: true,
    settings_match: true,
  });
});

test('baseline source lock mode excludes concurrent writers', async () => {
  // Given
  const lockClient = await openClient(databaseUrl, 'baseline-lock-test');
  const writerClient = await openClient(databaseUrl, 'baseline-writer-test');

  try {
    await lockClient.query('begin');
    await lockClient.query(`
      lock table
        miracon.projects,
        miracon.project_images,
        miracon.homepage_videos,
        miracon.site_settings,
        miracon.media_files
      in share mode
    `);
    await writerClient.query(`set lock_timeout = '100ms'`);

    // When / Then
    await assert.rejects(writerClient.query(`
      update miracon.projects set title = title where id = 'legacy-project'
    `), { code: '55P03' });
  } finally {
    await lockClient.query('rollback');
    await Promise.all([lockClient.end(), writerClient.end()]);
  }
});

test('links media found in complete baseline snapshots without duplicating references on runner re-entry', async () => {
  // Given / When
  const result = await client.query(`
    select revision_media.media_file_id
    from miracon.revision_media as revision_media
    join miracon.content_revisions as revision on revision.id = revision_media.revision_id
    where revision.aggregate_type = 'project'
      and revision.aggregate_id = 'legacy-project'
    order by revision_media.media_file_id
  `);

  // Then
  assert.deepEqual(result.rows, [
    { media_file_id: 'legacy-media' },
    { media_file_id: 'legacy-media-two' },
  ]);
});

test('project saves distinguish null, zero, and positive availability while preserving omission', async () => {
  // Given
  const project = { id: 'availability-project', slug: 'availability-project', title: 'Availability' };

  // When / Then
  await client.query('select miracon.save_project_with_images($1::jsonb)', [{ ...project, remaining_units: null }]);
  let result = await client.query(`select remaining_units from miracon.projects where id = 'availability-project'`);
  assert.equal(result.rows[0].remaining_units, null);

  await client.query('select miracon.save_project_with_images($1::jsonb)', [{ ...project, remaining_units: 0 }]);
  await client.query('select miracon.save_project_with_images($1::jsonb)', [project]);
  result = await client.query(`select remaining_units from miracon.projects where id = 'availability-project'`);
  assert.equal(result.rows[0].remaining_units, 0);

  await client.query('select miracon.save_project_with_images($1::jsonb)', [{ ...project, remaining_units: 7 }]);
  result = await client.query(`select remaining_units from miracon.projects where id = 'availability-project'`);
  assert.equal(result.rows[0].remaining_units, 7);
});

test('saving a draft keeps its publication timestamp empty', async () => {
  // Given / When
  await client.query('select miracon.save_project_with_images($1::jsonb, $2::jsonb)', [draft, JSON.stringify(images)]);
  const result = await client.query(`select published_at from miracon.projects where id = 'project-one'`);

  // Then
  assert.equal(result.rows[0].published_at, null);
});

test('publishing a draft assigns its publication timestamp', async () => {
  // Given / When
  await client.query('select miracon.save_project_with_images($1::jsonb, $2::jsonb)', [
    { ...draft, status: 'published' }, JSON.stringify(images),
  ]);
  const result = await client.query(`select published_at from miracon.projects where id = 'project-one'`);
  publishedAt = result.rows[0].published_at;

  // Then
  assert.ok(publishedAt instanceof Date);
});

test('editing a published project preserves its publication timestamp', async () => {
  // Given / When
  await client.query(`update miracon.projects set title = 'Published edit' where id = 'project-one'`);
  const result = await client.query(`select published_at from miracon.projects where id = 'project-one'`);

  // Then
  assert.deepEqual(result.rows[0].published_at, publishedAt);
});

test('supplied locale translations replace that complete locale and preserve sibling locales', async () => {
  // Given
  const update = { ...draft, status: 'published', translations: { el: { seoTitle: 'New Greek SEO' } } };

  // When
  await client.query('select miracon.save_project_with_images($1::jsonb, $2::jsonb)', [update, JSON.stringify(images)]);
  const result = await client.query(`select translations from miracon.projects where id = 'project-one'`);

  // Then
  assert.deepEqual(result.rows[0].translations, {
    de: { title: 'German title' },
    el: { seoTitle: 'New Greek SEO' },
  });
});

test('omitting translations preserves every existing locale unchanged', async () => {
  // Given
  const beforeSave = await client.query(`select translations from miracon.projects where id = 'project-one'`);
  const update = structuredClone(draft);
  delete update.translations;

  // When
  await client.query('select miracon.save_project_with_images($1::jsonb, $2::jsonb)', [update, JSON.stringify(images)]);
  const afterSave = await client.query(`select translations from miracon.projects where id = 'project-one'`);

  // Then
  assert.deepEqual(afterSave.rows[0].translations, beforeSave.rows[0].translations);
});

test('an invalid replacement image rolls back the complete project and image rows', async () => {
  // Given
  const projectBefore = await client.query(`select row_to_json(project) as row from miracon.projects project where id = 'project-one'`);
  const imagesBefore = await client.query(`select row_to_json(image) as row from miracon.project_images image where project_id = 'project-one' order by id`);

  // When
  await assert.rejects(client.query('select miracon.save_project_with_images($1::jsonb, $2::jsonb)', [
    { ...draft, title: 'Must roll back' },
    JSON.stringify([{ ...images[0], role: 'invalid-role' }]),
  ]));
  const projectAfter = await client.query(`select row_to_json(project) as row from miracon.projects project where id = 'project-one'`);
  const imagesAfter = await client.query(`select row_to_json(image) as row from miracon.project_images image where project_id = 'project-one' order by id`);

  // Then
  assert.deepEqual(projectAfter.rows, projectBefore.rows);
  assert.deepEqual(imagesAfter.rows, imagesBefore.rows);
});

test('project reorder and delete preserve ordering and foreign-key behavior', async () => {
  // Given
  await client.query(`
    insert into miracon.projects (id, slug, title, sort_order) values
      ('project-two', 'project-two', 'Second', 5),
      ('project-three', 'project-three', 'Third', 6)
  `);
  await client.query(`
    insert into miracon.homepage_videos (id, title, project_id, desktop_url, sort_order)
    values ('project-video', 'Project video', 'project-two', '/media/video.mp4', 9)
  `);

  // When
  await client.query('select miracon.reorder_projects($1::jsonb)', [JSON.stringify([
    { id: 'project-two', sort_order: 1 }, { id: 'project-three', sort_order: 0 },
  ])]);
  await client.query(`select miracon.delete_project('project-two')`);
  const result = await client.query(`
    select
      (select sort_order from miracon.projects where id = 'project-three') as remaining_order,
      (select project_id from miracon.homepage_videos where id = 'project-video') as detached_project
  `);

  // Then
  assert.deepEqual(result.rows[0], { remaining_order: 0, detached_project: null });
});

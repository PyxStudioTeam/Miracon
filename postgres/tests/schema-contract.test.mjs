import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationsDirectory = new URL('../migrations/', import.meta.url);

async function loadMigrations() {
  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith('.sql'))
    .sort();
  const contents = await Promise.all(
    filenames.map(async (filename) => readFile(new URL(filename, migrationsDirectory), 'utf8')),
  );
  return { filenames, sql: contents.join('\n') };
}

test('defines the standalone schema when migrations are read in filename order', async () => {
  // Given
  const { filenames, sql } = await loadMigrations();

  // When
  const ordered = filenames.every((filename, index) => index === 0 || filenames[index - 1] < filename);

  // Then
  assert.equal(ordered, true);
  assert.deepEqual(filenames, [
    '0001_content_tables.sql',
    '0002_admin_sessions_media.sql',
    '0003_project_operations.sql',
    '0004_ordering_and_homepage_operations.sql',
    '0005_login_throttle_cleanup.sql',
    '0006_tighten_admin_password_hash.sql',
    '0007_media_cleanup_pending.sql',
    '0008_admin_governance_and_availability.sql',
    '0009_exact_revision_materialization.sql',
  ]);
  for (const table of [
    'projects',
    'project_images',
    'homepage_videos',
    'site_settings',
    'admin_users',
    'admin_sessions',
    'login_throttle',
    'media_files',
    'content_revisions',
    'content_revision_heads',
    'audit_events',
    'revision_media',
  ]) {
    assert.match(sql, new RegExp(`create table miracon\\.${table}\\b`, 'i'));
  }
});

test('keeps the standalone migrations independent of Supabase and worker infrastructure', async () => {
  // Given
  const { sql } = await loadMigrations();

  // When
  const forbiddenDependency = /\b(?:auth|storage)\.|auth\.uid\(|create\s+extension|media_processing_jobs|media_variants|service_role|row\s+level\s+security/iu.exec(sql);

  // Then
  assert.equal(forbiddenDependency, null);
});

test('retains content fields and database transaction routines required by repositories', async () => {
  // Given
  const { sql } = await loadMigrations();
  const requiredContracts = [
    'translations jsonb',
    'hero_videos jsonb',
    'walkthrough_videos jsonb',
    'image_variants jsonb',
    'sort_order integer',
    'published_at timestamptz',
    'on delete cascade',
    'on delete set null',
    'password_hash text',
    'session_token_hash bytea',
    'csrf_token_hash bytea',
    'relative_url text',
    'relative_path text',
    'deletion_pending_at timestamptz',
    'remaining_units integer',
    'create function miracon.save_project_with_images',
    'create or replace function miracon.save_project_with_images',
    'create function miracon.reorder_projects',
    'create function miracon.delete_project',
    'create function miracon.replace_homepage_videos',
  ];

  // When / Then
  for (const contract of requiredContracts) {
    assert.match(sql.toLowerCase(), new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')));
  }
});

test('defines constrained governance, immutable audit, and deterministic aggregate baselines', async () => {
  // Given
  const sql = await readFile(new URL('../migrations/0008_admin_governance_and_availability.sql', import.meta.url), 'utf8');

  // When / Then
  for (const contract of [
    /create type miracon\.admin_role as enum \('owner', 'editor'\)/iu,
    /create type miracon\.content_aggregate_type as enum \('project', 'homepage_hero', 'site_settings'\)/iu,
    /create type miracon\.content_revision_state as enum \('pending', 'approved', 'rejected'\)/iu,
    /create type miracon\.content_revision_action as enum \('baseline', 'proposal', 'publish', 'rollback', 'delete'\)/iu,
    /add column remaining_units integer[\s\S]*remaining_units >= 0/iu,
    /drop constraint admin_users_id_check/iu,
    /add column role miracon\.admin_role not null default 'editor'/iu,
    /create sequence miracon\.admin_user_id_seq as smallint start with 2/iu,
    /set default nextval\('miracon\.admin_user_id_seq'/iu,
    /update miracon\.admin_users[\s\S]*set role = 'owner'[\s\S]*where id = 1/iu,
    /id = 1 and role = 'owner'[\s\S]*id > 1 and role = 'editor'/iu,
    /snapshot jsonb not null/iu,
    /miracon\.has_exact_jsonb_keys/iu,
    /select coalesce\([\s\S]*jsonb_typeof\(p_snapshot->'aggregateType'\) = 'string'[\s\S]*jsonb_typeof\(p_snapshot->'aggregateId'\) = 'string'/iu,
    /jsonb_typeof\(p_snapshot->'project'->'id'\) = 'string'[\s\S]*is not distinct from p_aggregate_id/iu,
    /jsonb_typeof\(image->'project_id'\) is distinct from 'string'/iu,
    /jsonb_typeof\(p_snapshot->'settings'->'id'\) = 'number'[\s\S]*is not distinct from '1'::jsonb/iu,
    /'published_at', 'created_at', 'updated_at', 'remaining_units'/iu,
    /'width', 'height', 'focal_x', 'focal_y', 'created_at'/iu,
    /'mobile_storage_path', 'sort_order', 'is_active', 'created_at', 'updated_at'/iu,
    /'footer_cookie_visible', 'footer_cookie_pdf_url', 'updated_at'/iu,
    /image->>'project_id' is distinct from p_aggregate_id/iu,
    /unique \(aggregate_type, aggregate_id, revision_number\)/iu,
    /create trigger content_revisions_guard_changes/iu,
    /create trigger content_revision_heads_require_approved[\s\S]*before insert or update or delete on miracon\.content_revision_heads/iu,
    /create trigger audit_events_reject_changes/iu,
    /before truncate on miracon\.content_revisions/iu,
    /before truncate on miracon\.content_revision_heads/iu,
    /before truncate on miracon\.audit_events/iu,
    /before update or delete on miracon\.revision_media/iu,
    /before truncate on miracon\.revision_media/iu,
    /revoke update, delete, truncate on miracon\.content_revision_heads, miracon\.content_revisions, miracon\.audit_events, miracon\.revision_media from public/iu,
    /lock table[\s\S]*miracon\.projects[\s\S]*miracon\.project_images[\s\S]*miracon\.homepage_videos[\s\S]*miracon\.site_settings[\s\S]*miracon\.media_files[\s\S]*in share mode/iu,
    /md5\('miracon:baseline:project:' \|\| project\.id\)::uuid/iu,
    /'homepage_hero'::miracon\.content_aggregate_type[\s\S]*'singleton'/iu,
    /'site_settings'::miracon\.content_aggregate_type[\s\S]*'singleton'/iu,
    /insert into miracon\.revision_media/iu,
    /create or replace function miracon\.save_project_with_images/iu,
    /p_project \? 'remaining_units'/iu,
  ]) {
    assert.match(sql, contract);
  }
});

test('serializes whole-playlist homepage replacement with a transaction advisory lock', async () => {
  // Given
  const sql = await readFile(new URL('../migrations/0004_ordering_and_homepage_operations.sql', import.meta.url), 'utf8');

  // When
  const replacementFunction = sql.slice(sql.indexOf('create function miracon.replace_homepage_videos'));

  // Then
  assert.match(replacementFunction, /pg_advisory_xact_lock\s*\(/u);
});

test('materializes approved revisions exactly through a scoped invoker routine', async () => {
  // Given
  const sql = await readFile(new URL('../migrations/0009_exact_revision_materialization.sql', import.meta.url), 'utf8');

  // When / Then
  for (const contract of [
    /create function miracon\.materialize_content_revision\(p_revision_id uuid\) returns jsonb/iu,
    /security invoker/iu,
    /where id = p_revision_id[\s\S]*state = 'approved'/iu,
    /set_config\([\s\S]*true\)/iu,
    /exception[\s\S]*set_config/iu,
    /delete from miracon\.project_images/iu,
    /insert into miracon\.project_images[\s\S]*jsonb_populate_recordset\(null::miracon\.project_images/iu,
    /insert into miracon\.homepage_videos[\s\S]*jsonb_populate_recordset\(null::miracon\.homepage_videos/iu,
    /update miracon\.site_settings[\s\S]*updated_at/iu,
    /pg_advisory_xact_lock\(hashtextextended\('homepage_hero:singleton'[\s\S]*pg_advisory_xact_lock\(hashtextextended\('miracon\.replace_homepage_videos'/iu,
    /exists \([\s\S]*from miracon\.homepage_videos where project_id = v_revision\.aggregate_id[\s\S]*raise exception 'Homepage references project'/iu,
    /revoke all on function miracon\.materialize_content_revision\(uuid\) from public/iu,
  ]) {
    assert.match(sql, contract);
  }
  assert.doesNotMatch(sql, /session_replication_role|disable trigger/iu);
});

create type miracon.admin_role as enum ('owner', 'editor');
create type miracon.content_aggregate_type as enum ('project', 'homepage_hero', 'site_settings');
create type miracon.content_revision_state as enum ('pending', 'approved', 'rejected');
create type miracon.content_revision_action as enum ('baseline', 'proposal', 'publish', 'rollback', 'delete');
create type miracon.content_audit_action as enum ('proposal', 'publish', 'approve', 'reject', 'rollback', 'delete');

alter table miracon.admin_users
drop constraint admin_users_id_check;

alter table miracon.admin_users
add column role miracon.admin_role not null default 'editor';

update miracon.admin_users
set role = 'owner'
where id = 1;

create sequence miracon.admin_user_id_seq as smallint start with 2;

alter sequence miracon.admin_user_id_seq owned by miracon.admin_users.id;

alter table miracon.admin_users
alter column id set default nextval('miracon.admin_user_id_seq');

alter table miracon.admin_users
add constraint admin_users_owner_identity_check
check (
  (id = 1 and role = 'owner')
  or (id > 1 and role = 'editor')
);

alter table miracon.projects
add column remaining_units integer,
add constraint projects_remaining_units_check
check (remaining_units is null or remaining_units >= 0);

create function miracon.has_exact_jsonb_keys(p_value jsonb, p_keys text[])
returns boolean
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select case
    when jsonb_typeof(p_value) = 'object'
      then p_value ?& p_keys
        and not exists (
          select 1
          from jsonb_object_keys(p_value) as object_key
          where object_key <> all(p_keys)
        )
    else false
  end;
$$;

create function miracon.is_valid_content_snapshot(
  p_aggregate_type miracon.content_aggregate_type,
  p_aggregate_id text,
  p_snapshot jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select coalesce(
    jsonb_typeof(p_snapshot) = 'object'
    and jsonb_typeof(p_snapshot->'aggregateType') = 'string'
    and p_snapshot->>'aggregateType' is not distinct from p_aggregate_type::text
    and jsonb_typeof(p_snapshot->'aggregateId') = 'string'
    and p_snapshot->>'aggregateId' is not distinct from p_aggregate_id
    and case p_aggregate_type
      when 'project' then
        miracon.has_exact_jsonb_keys(
          p_snapshot,
          array['aggregateType', 'aggregateId', 'deleted', 'project', 'images']
        )
        and jsonb_typeof(p_snapshot->'deleted') = 'boolean'
        and jsonb_typeof(p_snapshot->'images') = 'array'
        and (
          (
            p_snapshot->'deleted' = 'true'::jsonb
            and p_snapshot->'project' = 'null'::jsonb
            and jsonb_array_length(p_snapshot->'images') = 0
          )
          or
          (
            p_snapshot->'deleted' = 'false'::jsonb
            and jsonb_typeof(p_snapshot->'project') = 'object'
            and miracon.has_exact_jsonb_keys(
              p_snapshot->'project',
              array[
                'id', 'slug', 'title', 'address', 'card_address', 'price', 'short_description',
                'full_description', 'intro_title', 'categories', 'status', 'sort_order', 'cover_url',
                'cover_focal_x', 'cover_focal_y', 'image_variants', 'hero_type', 'hero_variant',
                'hero_sound_enabled', 'hero_idle_ui', 'hero_url', 'hero_mobile_url', 'hero_poster_url',
                'hero_videos', 'walkthrough_video_enabled', 'walkthrough_video_title',
                'walkthrough_video_desktop_url', 'walkthrough_video_mobile_url',
                'walkthrough_video_poster_url', 'walkthrough_videos', 'hero_focal_x', 'hero_focal_y',
                'intro_image_url', 'brochure_url', 'map_query', 'map_url', 'characteristics', 'benefits',
                'floor_plan_groups', 'nearby_places', 'translations', 'seo_title', 'seo_description',
                'published_at', 'created_at', 'updated_at', 'remaining_units'
              ]
            )
            and jsonb_typeof(p_snapshot->'project'->'id') = 'string'
            and p_snapshot->'project'->>'id' is not distinct from p_aggregate_id
            and not exists (
              select 1
              from jsonb_array_elements(p_snapshot->'images') as image
              where jsonb_typeof(image) <> 'object'
                or not miracon.has_exact_jsonb_keys(
                  image,
                  array[
                    'id', 'project_id', 'url', 'storage_path', 'alt', 'role', 'sort_order',
                    'width', 'height', 'focal_x', 'focal_y', 'created_at'
                  ]
                )
                or jsonb_typeof(image->'project_id') is distinct from 'string'
                or image->>'project_id' is distinct from p_aggregate_id
            )
          )
        )
      when 'homepage_hero' then
        miracon.has_exact_jsonb_keys(p_snapshot, array['aggregateType', 'aggregateId', 'videos'])
        and p_aggregate_id = 'singleton'
        and jsonb_typeof(p_snapshot->'videos') = 'array'
        and not exists (
          select 1
          from jsonb_array_elements(p_snapshot->'videos') as video
          where jsonb_typeof(video) <> 'object'
            or not miracon.has_exact_jsonb_keys(
              video,
              array[
                'id', 'title', 'project_id', 'desktop_url', 'desktop_storage_path', 'mobile_url',
                'mobile_storage_path', 'sort_order', 'is_active', 'created_at', 'updated_at'
              ]
            )
        )
      when 'site_settings' then
        miracon.has_exact_jsonb_keys(p_snapshot, array['aggregateType', 'aggregateId', 'settings'])
        and p_aggregate_id = 'singleton'
        and jsonb_typeof(p_snapshot->'settings') = 'object'
        and miracon.has_exact_jsonb_keys(
          p_snapshot->'settings',
          array[
            'id', 'footer_terms_visible', 'footer_terms_pdf_url', 'footer_privacy_visible',
            'footer_privacy_pdf_url', 'footer_cookie_visible', 'footer_cookie_pdf_url', 'updated_at'
          ]
        )
        and jsonb_typeof(p_snapshot->'settings'->'id') = 'number'
        and p_snapshot->'settings'->'id' is not distinct from '1'::jsonb
      else false
    end,
    false
  );
$$;

create table miracon.content_revisions (
  id uuid primary key default gen_random_uuid(),
  aggregate_type miracon.content_aggregate_type not null,
  aggregate_id text not null check (btrim(aggregate_id) <> ''),
  revision_number bigint not null check (revision_number > 0),
  state miracon.content_revision_state not null,
  action miracon.content_revision_action not null,
  snapshot jsonb not null,
  expected_revision_id uuid,
  created_by smallint references miracon.admin_users(id) on delete restrict,
  approved_by smallint references miracon.admin_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  unique (aggregate_type, aggregate_id, revision_number),
  unique (id, aggregate_type, aggregate_id),
  unique (id, aggregate_type, aggregate_id, revision_number),
  foreign key (expected_revision_id, aggregate_type, aggregate_id)
    references miracon.content_revisions(id, aggregate_type, aggregate_id) on delete restrict,
  check (aggregate_type = 'project' or aggregate_id = 'singleton'),
  check (miracon.is_valid_content_snapshot(aggregate_type, aggregate_id, snapshot)),
  check (
    (
      action = 'baseline'
      and state = 'approved'
      and revision_number = 1
      and expected_revision_id is null
      and created_by is null
    )
    or (action = 'proposal' and created_by is not null)
    or (action in ('publish', 'rollback', 'delete') and state = 'approved' and created_by is not null)
  ),
  check (
    (state in ('pending', 'rejected') and approved_by is null and approved_at is null)
    or (
      state = 'approved'
      and approved_at is not null
      and ((action = 'baseline' and approved_by is null) or (action <> 'baseline' and approved_by is not null))
    )
  )
);

create table miracon.content_revision_heads (
  aggregate_type miracon.content_aggregate_type not null,
  aggregate_id text not null check (btrim(aggregate_id) <> ''),
  current_revision_id uuid not null unique,
  current_revision_number bigint not null check (current_revision_number > 0),
  primary key (aggregate_type, aggregate_id),
  foreign key (current_revision_id, aggregate_type, aggregate_id, current_revision_number)
    references miracon.content_revisions(id, aggregate_type, aggregate_id, revision_number) on delete restrict,
  check (aggregate_type = 'project' or aggregate_id = 'singleton')
);

create table miracon.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id smallint not null references miracon.admin_users(id) on delete restrict,
  session_id text references miracon.admin_sessions(id) on delete set null,
  aggregate_type miracon.content_aggregate_type not null,
  aggregate_id text not null check (btrim(aggregate_id) <> ''),
  revision_id uuid not null,
  action miracon.content_audit_action not null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (revision_id, aggregate_type, aggregate_id)
    references miracon.content_revisions(id, aggregate_type, aggregate_id) on delete restrict,
  check (aggregate_type = 'project' or aggregate_id = 'singleton'),
  check (miracon.is_valid_content_snapshot(aggregate_type, aggregate_id, before_snapshot)),
  check (miracon.is_valid_content_snapshot(aggregate_type, aggregate_id, after_snapshot))
);

create table miracon.revision_media (
  revision_id uuid not null references miracon.content_revisions(id) on delete restrict,
  media_file_id text not null references miracon.media_files(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (revision_id, media_file_id)
);

create index content_revisions_aggregate_created_idx
on miracon.content_revisions (aggregate_type, aggregate_id, revision_number desc);

create index content_revisions_pending_idx
on miracon.content_revisions (created_at, id)
where state = 'pending';

create index audit_events_aggregate_created_idx
on miracon.audit_events (aggregate_type, aggregate_id, created_at desc, id);

create index revision_media_file_idx
on miracon.revision_media (media_file_id, revision_id);

create function miracon.guard_content_revision_changes()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Content revisions cannot be deleted' using errcode = '55000';
  end if;

  if new.id is distinct from old.id
    or new.aggregate_type is distinct from old.aggregate_type
    or new.aggregate_id is distinct from old.aggregate_id
    or new.revision_number is distinct from old.revision_number
    or new.action is distinct from old.action
    or new.snapshot is distinct from old.snapshot
    or new.expected_revision_id is distinct from old.expected_revision_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'Content revision snapshots and identity are immutable' using errcode = '55000';
  end if;

  if old.state <> 'pending' or new.state not in ('approved', 'rejected') then
    raise exception 'Content revisions only transition from pending to approved or rejected' using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger content_revisions_guard_changes
before update or delete on miracon.content_revisions
for each row execute function miracon.guard_content_revision_changes();

create function miracon.require_approved_content_revision_head()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_expected_revision_id uuid;
  v_revision_number bigint;
begin
  if tg_op = 'DELETE' then
    raise exception 'Content revision heads cannot be deleted' using errcode = '55000';
  end if;

  select revision.expected_revision_id, revision.revision_number
  into v_expected_revision_id, v_revision_number
  from miracon.content_revisions as revision
  where revision.id = new.current_revision_id
    and revision.aggregate_type = new.aggregate_type
    and revision.aggregate_id = new.aggregate_id
    and revision.revision_number = new.current_revision_number
    and revision.state = 'approved';

  if not found then
    raise exception 'Content revision heads must reference an approved revision' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' and v_expected_revision_id is not null then
    raise exception 'Initial content revision heads require an unbased revision' using errcode = '55000';
  end if;

  if tg_op = 'UPDATE' and (
    v_revision_number <= old.current_revision_number
    or v_expected_revision_id is distinct from old.current_revision_id
  ) then
    raise exception 'Content revision heads only advance from their current revision' using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger content_revision_heads_require_approved
before insert or update or delete on miracon.content_revision_heads
for each row execute function miracon.require_approved_content_revision_head();

create function miracon.reject_audit_event_changes()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Audit events are append-only' using errcode = '55000';
end;
$$;

create trigger audit_events_reject_changes
before update or delete on miracon.audit_events
for each row execute function miracon.reject_audit_event_changes();

create function miracon.reject_immutable_history_statement()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Governance history cannot be truncated' using errcode = '55000';
end;
$$;

create trigger content_revisions_reject_truncate
before truncate on miracon.content_revisions
for each statement execute function miracon.reject_immutable_history_statement();

create trigger content_revision_heads_reject_truncate
before truncate on miracon.content_revision_heads
for each statement execute function miracon.reject_immutable_history_statement();

create trigger audit_events_reject_truncate
before truncate on miracon.audit_events
for each statement execute function miracon.reject_immutable_history_statement();

create function miracon.reject_revision_media_changes()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Revision media is append-only' using errcode = '55000';
end;
$$;

create trigger revision_media_reject_changes
before update or delete on miracon.revision_media
for each row execute function miracon.reject_revision_media_changes();

create trigger revision_media_reject_truncate
before truncate on miracon.revision_media
for each statement execute function miracon.reject_immutable_history_statement();

revoke update, delete, truncate on miracon.content_revision_heads, miracon.content_revisions, miracon.audit_events, miracon.revision_media from public;

insert into miracon.site_settings (id)
values (1)
on conflict (id) do nothing;

lock table
  miracon.projects,
  miracon.project_images,
  miracon.homepage_videos,
  miracon.site_settings,
  miracon.media_files
in share mode;

insert into miracon.content_revisions (
  id, aggregate_type, aggregate_id, revision_number, state, action, snapshot, created_at, approved_at
)
select
  md5('miracon:baseline:project:' || project.id)::uuid,
  'project'::miracon.content_aggregate_type,
  project.id,
  1,
  'approved'::miracon.content_revision_state,
  'baseline'::miracon.content_revision_action,
  jsonb_build_object(
    'aggregateType', 'project',
    'aggregateId', project.id,
    'deleted', false,
    'project', to_jsonb(project),
    'images', coalesce((
      select jsonb_agg(to_jsonb(image) order by image.role, image.sort_order, image.id)
      from miracon.project_images as image
      where image.project_id = project.id
    ), '[]'::jsonb)
  ),
  project.updated_at,
  project.updated_at
from miracon.projects as project;

insert into miracon.content_revisions (
  id, aggregate_type, aggregate_id, revision_number, state, action, snapshot, created_at, approved_at
)
select
  md5('miracon:baseline:homepage_hero:singleton')::uuid,
  'homepage_hero'::miracon.content_aggregate_type,
  'singleton',
  1,
  'approved'::miracon.content_revision_state,
  'baseline'::miracon.content_revision_action,
  jsonb_build_object(
    'aggregateType', 'homepage_hero',
    'aggregateId', 'singleton',
    'videos', coalesce(jsonb_agg(to_jsonb(video) order by video.sort_order, video.id)
      filter (where video.id is not null), '[]'::jsonb)
  ),
  coalesce(max(video.updated_at), '1970-01-01 00:00:00+00'::timestamptz),
  coalesce(max(video.updated_at), '1970-01-01 00:00:00+00'::timestamptz)
from (select 1) as singleton
left join miracon.homepage_videos as video on true;

insert into miracon.content_revisions (
  id, aggregate_type, aggregate_id, revision_number, state, action, snapshot, created_at, approved_at
)
select
  md5('miracon:baseline:site_settings:singleton')::uuid,
  'site_settings'::miracon.content_aggregate_type,
  'singleton',
  1,
  'approved'::miracon.content_revision_state,
  'baseline'::miracon.content_revision_action,
  jsonb_build_object(
    'aggregateType', 'site_settings',
    'aggregateId', 'singleton',
    'settings', to_jsonb(settings)
  ),
  settings.updated_at,
  settings.updated_at
from miracon.site_settings as settings
where settings.id = 1;

insert into miracon.content_revision_heads (
  aggregate_type, aggregate_id, current_revision_id, current_revision_number
)
select aggregate_type, aggregate_id, id, revision_number
from miracon.content_revisions
where action = 'baseline';

insert into miracon.revision_media (revision_id, media_file_id)
select revision.id, media.id
from miracon.content_revisions as revision
join miracon.media_files as media
  on jsonb_path_exists(
    revision.snapshot,
    '$.** ? (@ == $url)'::jsonpath,
    jsonb_build_object('url', media.relative_url)
  )
where revision.action = 'baseline';

create or replace function miracon.save_project_with_images(
  p_project jsonb,
  p_images jsonb default '[]'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_project_id text := p_project->>'id';
  v_has_translations boolean := p_project ? 'translations';
  v_has_hero_videos boolean := p_project ? 'hero_videos';
  v_has_walkthrough_videos boolean := p_project ? 'walkthrough_videos';
begin
  if v_project_id is null or btrim(v_project_id) = '' then
    raise exception 'Project id is required' using errcode = '22023';
  end if;
  if p_images is null or jsonb_typeof(p_images) <> 'array' then
    raise exception 'Project images must be a JSON array' using errcode = '22023';
  end if;
  if v_has_translations and jsonb_typeof(p_project->'translations') is distinct from 'object' then
    raise exception 'Project translations must be a JSON object' using errcode = '22023';
  end if;

  insert into miracon.projects (
    id, slug, title, address, card_address, price, remaining_units, short_description, full_description,
    intro_title, categories, status, sort_order, cover_url, cover_focal_x, cover_focal_y,
    image_variants, hero_type, hero_variant, hero_sound_enabled, hero_idle_ui, hero_url,
    hero_mobile_url, hero_poster_url, hero_videos, walkthrough_video_enabled,
    walkthrough_video_title, walkthrough_video_desktop_url, walkthrough_video_mobile_url,
    walkthrough_video_poster_url, walkthrough_videos, hero_focal_x, hero_focal_y,
    intro_image_url, brochure_url, map_query, map_url, characteristics, benefits,
    floor_plan_groups, nearby_places, translations, seo_title, seo_description
  )
  values (
    v_project_id,
    p_project->>'slug',
    p_project->>'title',
    coalesce(p_project->>'address', ''),
    coalesce(p_project->>'card_address', ''),
    coalesce(p_project->>'price', ''),
    (p_project->>'remaining_units')::integer,
    coalesce(p_project->>'short_description', ''),
    coalesce(p_project->>'full_description', ''),
    coalesce(p_project->>'intro_title', ''),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_project->'categories', '[]'::jsonb))), '{}'),
    coalesce(p_project->>'status', 'draft')::miracon.project_status,
    coalesce((p_project->>'sort_order')::integer, 0),
    coalesce(p_project->>'cover_url', ''),
    coalesce((p_project->>'cover_focal_x')::numeric, 50),
    coalesce((p_project->>'cover_focal_y')::numeric, 50),
    coalesce(nullif(p_project->'image_variants', 'null'::jsonb), '{"version":1,"images":{}}'::jsonb),
    coalesce(p_project->>'hero_type', 'image'),
    coalesce(p_project->>'hero_variant', 'standard'),
    coalesce((p_project->>'hero_sound_enabled')::boolean, false),
    coalesce((p_project->>'hero_idle_ui')::boolean, false),
    coalesce(p_project->>'hero_url', ''),
    nullif(p_project->>'hero_mobile_url', ''),
    nullif(p_project->>'hero_poster_url', ''),
    coalesce(nullif(p_project->'hero_videos', 'null'::jsonb), '[]'::jsonb),
    coalesce((p_project->>'walkthrough_video_enabled')::boolean, false),
    coalesce(nullif(p_project->>'walkthrough_video_title', ''), 'Virtual walkthrough'),
    coalesce(p_project->>'walkthrough_video_desktop_url', ''),
    nullif(p_project->>'walkthrough_video_mobile_url', ''),
    nullif(p_project->>'walkthrough_video_poster_url', ''),
    coalesce(nullif(p_project->'walkthrough_videos', 'null'::jsonb), '[]'::jsonb),
    coalesce((p_project->>'hero_focal_x')::numeric, 50),
    coalesce((p_project->>'hero_focal_y')::numeric, 50),
    coalesce(p_project->>'intro_image_url', ''),
    nullif(p_project->>'brochure_url', ''),
    coalesce(p_project->>'map_query', ''),
    coalesce(p_project->>'map_url', ''),
    coalesce(nullif(p_project->'characteristics', 'null'::jsonb), '[]'::jsonb),
    coalesce(nullif(p_project->'benefits', 'null'::jsonb), '[]'::jsonb),
    coalesce(nullif(p_project->'floor_plan_groups', 'null'::jsonb), '[]'::jsonb),
    coalesce(nullif(p_project->'nearby_places', 'null'::jsonb), '[]'::jsonb),
    coalesce(nullif(p_project->'translations', 'null'::jsonb), '{}'::jsonb),
    coalesce(p_project->>'seo_title', ''),
    coalesce(p_project->>'seo_description', '')
  )
  on conflict (id) do update set
    slug = excluded.slug,
    title = excluded.title,
    address = excluded.address,
    card_address = case when p_project ? 'card_address' then excluded.card_address else projects.card_address end,
    price = excluded.price,
    remaining_units = case when p_project ? 'remaining_units' then excluded.remaining_units else projects.remaining_units end,
    short_description = excluded.short_description,
    full_description = excluded.full_description,
    intro_title = excluded.intro_title,
    categories = excluded.categories,
    status = excluded.status,
    sort_order = excluded.sort_order,
    cover_url = excluded.cover_url,
    cover_focal_x = excluded.cover_focal_x,
    cover_focal_y = excluded.cover_focal_y,
    image_variants = case when p_project ? 'image_variants' then excluded.image_variants else projects.image_variants end,
    hero_type = excluded.hero_type,
    hero_variant = excluded.hero_variant,
    hero_sound_enabled = excluded.hero_sound_enabled,
    hero_idle_ui = excluded.hero_idle_ui,
    hero_url = excluded.hero_url,
    hero_mobile_url = case when p_project ? 'hero_mobile_url' then excluded.hero_mobile_url else projects.hero_mobile_url end,
    hero_poster_url = excluded.hero_poster_url,
    hero_videos = case
      when v_has_hero_videos then excluded.hero_videos
      when p_project ? 'hero_url' and excluded.hero_type = 'video' and nullif(excluded.hero_url, '') is not null
        then jsonb_build_array(jsonb_build_object(
          'id', projects.id || '-hero-1', 'desktopUrl', excluded.hero_url,
          'mobileUrl', excluded.hero_mobile_url, 'posterUrl', excluded.hero_poster_url
        ))
      when p_project ? 'hero_url' then '[]'::jsonb
      else projects.hero_videos
    end,
    walkthrough_video_enabled = case when p_project ? 'walkthrough_video_enabled' then excluded.walkthrough_video_enabled else projects.walkthrough_video_enabled end,
    walkthrough_video_title = case when p_project ? 'walkthrough_video_title' then excluded.walkthrough_video_title else projects.walkthrough_video_title end,
    walkthrough_video_desktop_url = case when p_project ? 'walkthrough_video_desktop_url' then excluded.walkthrough_video_desktop_url else projects.walkthrough_video_desktop_url end,
    walkthrough_video_mobile_url = case when p_project ? 'walkthrough_video_mobile_url' then excluded.walkthrough_video_mobile_url else projects.walkthrough_video_mobile_url end,
    walkthrough_video_poster_url = case when p_project ? 'walkthrough_video_poster_url' then excluded.walkthrough_video_poster_url else projects.walkthrough_video_poster_url end,
    walkthrough_videos = case
      when v_has_walkthrough_videos then excluded.walkthrough_videos
      when p_project ? 'walkthrough_video_desktop_url' and nullif(excluded.walkthrough_video_desktop_url, '') is not null
        then jsonb_build_array(jsonb_build_object(
          'id', projects.id || '-walkthrough-1', 'desktopUrl', excluded.walkthrough_video_desktop_url,
          'mobileUrl', excluded.walkthrough_video_mobile_url, 'posterUrl', excluded.walkthrough_video_poster_url
        ))
      when p_project ? 'walkthrough_video_desktop_url' then '[]'::jsonb
      else projects.walkthrough_videos
    end,
    hero_focal_x = excluded.hero_focal_x,
    hero_focal_y = excluded.hero_focal_y,
    intro_image_url = excluded.intro_image_url,
    brochure_url = excluded.brochure_url,
    map_query = excluded.map_query,
    map_url = case when p_project ? 'map_url' then excluded.map_url else projects.map_url end,
    characteristics = excluded.characteristics,
    benefits = excluded.benefits,
    floor_plan_groups = excluded.floor_plan_groups,
    nearby_places = excluded.nearby_places,
    translations = case when v_has_translations then projects.translations || excluded.translations else projects.translations end,
    seo_title = excluded.seo_title,
    seo_description = excluded.seo_description;

  delete from miracon.project_images where project_id = v_project_id;

  insert into miracon.project_images
    (id, project_id, url, storage_path, alt, role, sort_order, width, height, focal_x, focal_y)
  select
    image.id, v_project_id, image.url, nullif(image.storage_path, ''), coalesce(image.alt, ''),
    image.role::miracon.project_image_role, coalesce(image.sort_order, 0), image.width, image.height,
    coalesce(image.focal_x, 50), coalesce(image.focal_y, 50)
  from jsonb_to_recordset(p_images) as image(
    id text, url text, storage_path text, alt text, role text, sort_order integer,
    width integer, height integer, focal_x numeric, focal_y numeric
  );
end;
$$;

revoke execute on function miracon.is_valid_content_snapshot(miracon.content_aggregate_type, text, jsonb) from public;
revoke execute on function miracon.has_exact_jsonb_keys(jsonb, text[]) from public;
revoke execute on function miracon.save_project_with_images(jsonb, jsonb) from public;

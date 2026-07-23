alter table public.projects
  add column if not exists image_variants jsonb not null default '{"version":1,"images":{}}'::jsonb,
  add column if not exists hero_mobile_url text;

alter table public.projects
  drop constraint if exists projects_image_variants_object_check;

alter table public.projects
  add constraint projects_image_variants_object_check
  check (jsonb_typeof(image_variants) = 'object');

create type public.media_asset_status as enum ('queued', 'processing', 'ready', 'failed');
create type public.media_processing_job_status as enum ('queued', 'processing', 'completed', 'failed');

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  source_bucket text not null default 'media-sources'
    check (source_bucket in ('media-sources', 'project-media', 'project-documents')),
  source_path text not null check (btrim(source_path) <> ''),
  media_type text not null check (media_type in ('image', 'video', 'document')),
  mime_type text not null check (
    mime_type in (
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/avif',
      'image/svg+xml',
      'video/mp4',
      'application/pdf'
    )
  ),
  source_size_bytes bigint check (
    source_size_bytes is null or source_size_bytes between 1 and 209715200
  ),
  requested_variants jsonb not null default '[]'::jsonb
    check (jsonb_typeof(requested_variants) = 'array'),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  status public.media_asset_status not null default 'queued',
  result jsonb not null default '{}'::jsonb
    check (jsonb_typeof(result) = 'object'),
  last_error text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  processed_at timestamptz,
  source_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_bucket, source_path)
);

create table public.media_variants (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.media_assets(id) on delete cascade,
  variant_key text not null check (btrim(variant_key) <> ''),
  bucket_id text not null check (btrim(bucket_id) <> ''),
  object_path text not null check (btrim(object_path) <> ''),
  url text not null check (btrim(url) <> ''),
  mime_type text not null check (btrim(mime_type) <> ''),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  size_bytes bigint check (size_bytes is null or size_bytes > 0),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  deleted_at timestamptz,
  storage_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (storage_deleted_at is null or deleted_at is not null),
  unique (asset_id, variant_key),
  unique (bucket_id, object_path)
);

create table public.media_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null unique references public.media_assets(id) on delete cascade,
  status public.media_processing_job_status not null default 'queued',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  lease_token uuid,
  leased_at timestamptz,
  lease_expires_at timestamptz,
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  result jsonb not null default '{}'::jsonb
    check (jsonb_typeof(result) = 'object'),
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'processing' and lease_token is not null and leased_at is not null and lease_expires_at is not null)
    or (status <> 'processing' and lease_token is null and leased_at is null and lease_expires_at is null)
  )
);

create index media_assets_status_created_idx
on public.media_assets(status, created_at);

create index media_variants_asset_idx
on public.media_variants(asset_id, created_at);

create index media_variants_cleanup_idx
on public.media_variants(coalesce(deleted_at, created_at))
where storage_deleted_at is null;

create index media_processing_jobs_queue_idx
on public.media_processing_jobs(available_at, created_at)
where status = 'queued';

create index media_processing_jobs_lease_idx
on public.media_processing_jobs(lease_expires_at)
where status = 'processing';

create or replace function public.set_media_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger media_assets_set_updated_at
before insert or update on public.media_assets
for each row execute function public.set_media_updated_at();

create trigger media_variants_set_updated_at
before insert or update on public.media_variants
for each row execute function public.set_media_updated_at();

create trigger media_processing_jobs_set_updated_at
before insert or update on public.media_processing_jobs
for each row execute function public.set_media_updated_at();

alter table public.media_assets enable row level security;
alter table public.media_variants enable row level security;
alter table public.media_processing_jobs enable row level security;

create policy "Admins can view media assets"
on public.media_assets for select
to authenticated
using (public.is_admin());

create policy "Admins can insert media assets"
on public.media_assets for insert
to authenticated
with check (public.is_admin());

create policy "Admins can view media variants"
on public.media_variants for select
to authenticated
using (public.is_admin());

create policy "Admins can view media processing jobs"
on public.media_processing_jobs for select
to authenticated
using (public.is_admin());

create policy "Admins can insert media processing jobs"
on public.media_processing_jobs for insert
to authenticated
with check (public.is_admin());

grant usage on type public.media_asset_status, public.media_processing_job_status
to authenticated, service_role;

grant select, insert on public.media_assets to authenticated;
grant select on public.media_variants to authenticated;
grant select, insert on public.media_processing_jobs to authenticated;

grant select, insert, update on public.media_assets to service_role;
grant select, insert, update on public.media_variants to service_role;
grant select, insert, update on public.media_processing_jobs to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media-sources',
  'media-sources',
  false,
  209715200,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'video/mp4']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

update storage.buckets
set allowed_mime_types = array['video/mp4', 'image/webp']
where id = 'site-media';

create policy "Admins can read media sources"
on storage.objects for select
to authenticated
using (bucket_id = 'media-sources' and public.is_admin());

create policy "Admins can upload media sources"
on storage.objects for insert
to authenticated
with check (bucket_id = 'media-sources' and public.is_admin());

create policy "Admins can delete media sources"
on storage.objects for delete
to authenticated
using (bucket_id = 'media-sources' and public.is_admin());

create or replace view public.media_reference_urls
with (security_invoker = true)
as
select
  'projects'::text as source_table,
  project.id::text as source_id,
  reference.reference_key::text as reference_key,
  reference.url::text as url
from public.projects as project
cross join lateral (
  values
    ('cover_url', project.cover_url),
    ('hero_url', project.hero_url),
    ('hero_poster_url', project.hero_poster_url),
    ('hero_mobile_url', project.hero_mobile_url),
    ('intro_image_url', project.intro_image_url),
    ('brochure_url', project.brochure_url)
) as reference(reference_key, url)
where nullif(reference.url, '') is not null

union all

select
  'projects'::text,
  project.id::text,
  'image_variants.' || variant.ordinal::text,
  variant.value #>> '{}'
from public.projects as project
cross join lateral jsonb_path_query(
  project.image_variants,
  '$.** ? (@.type() == "string")'
) with ordinality as variant(value, ordinal)
where nullif(variant.value #>> '{}', '') is not null

union all

select
  'project_images'::text,
  image.id::text,
  image.role::text || '.url',
  image.url::text
from public.project_images as image
where nullif(image.url, '') is not null

union all

select
  'homepage_videos'::text,
  video.id::text,
  reference.reference_key::text,
  reference.url::text
from public.homepage_videos as video
cross join lateral (
  values
    ('desktop_url', video.desktop_url),
    ('mobile_url', video.mobile_url)
) as reference(reference_key, url)
where nullif(reference.url, '') is not null

union all

select
  'projects'::text,
  project.id::text,
  'benefits.' || coalesce(benefit.value->>'id', benefit.ordinal::text) || '.icon',
  benefit.value->>'icon'
from public.projects as project
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(project.benefits) = 'array' then project.benefits else '[]'::jsonb end
) with ordinality as benefit(value, ordinal)
where nullif(benefit.value->>'icon', '') is not null

union all

select
  'projects'::text,
  project.id::text,
  'floor_plan_groups.' || coalesce(plan_group.value->>'id', plan_group.ordinal::text)
    || '.plans.' || coalesce(plan.value->>'id', plan.ordinal::text) || '.imageUrl',
  plan.value->>'imageUrl'
from public.projects as project
cross join lateral jsonb_array_elements(
  case
    when jsonb_typeof(project.floor_plan_groups) = 'array' then project.floor_plan_groups
    else '[]'::jsonb
  end
) with ordinality as plan_group(value, ordinal)
cross join lateral jsonb_array_elements(
  case
    when jsonb_typeof(plan_group.value->'plans') = 'array' then plan_group.value->'plans'
    else '[]'::jsonb
  end
) with ordinality as plan(value, ordinal)
where nullif(plan.value->>'imageUrl', '') is not null;

revoke all on public.media_reference_urls from public, anon;
grant select on public.media_reference_urls to authenticated, service_role;

create or replace function public.save_project_with_images(
  p_project jsonb,
  p_images jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_project_id text := p_project->>'id';
  v_incoming_urls text[];
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if v_project_id is null or v_project_id = '' then
    raise exception 'Project id is required' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct incoming.url), '{}'::text[])
  into v_incoming_urls
  from (
    select value #>> '{}' as url
    from jsonb_path_query(
      coalesce(p_project, '{}'::jsonb),
      '$.** ? (@.type() == "string")'
    ) as project_value(value)

    union

    select value #>> '{}'
    from jsonb_path_query(
      coalesce(p_images, '[]'::jsonb),
      '$.** ? (@.type() == "string")'
    ) as image_value(value)
  ) as incoming
  where nullif(incoming.url, '') is not null;

  perform pg_advisory_xact_lock(tracked.lock_key)
  from (
    select distinct hashtextextended(variant.url, 0) as lock_key
    from public.media_variants as variant
    where variant.url = any(v_incoming_urls)
  ) as tracked
  order by tracked.lock_key;

  if exists (
    select 1
    from public.media_variants as variant
    where variant.url = any(v_incoming_urls)
      and variant.deleted_at is not null
  ) then
    raise exception 'A project URL points to a tombstoned media variant' using errcode = '22023';
  end if;

  insert into public.projects (
    id,
    slug,
    title,
    address,
    card_address,
    price,
    short_description,
    full_description,
    intro_title,
    categories,
    status,
    sort_order,
    cover_url,
    cover_focal_x,
    cover_focal_y,
    image_variants,
    hero_type,
    hero_variant,
    hero_sound_enabled,
    hero_idle_ui,
    hero_url,
    hero_mobile_url,
    hero_poster_url,
    hero_focal_x,
    hero_focal_y,
    intro_image_url,
    brochure_url,
    map_query,
    map_url,
    characteristics,
    benefits,
    floor_plan_groups,
    nearby_places,
    seo_title,
    seo_description
  )
  values (
    v_project_id,
    p_project->>'slug',
    p_project->>'title',
    coalesce(p_project->>'address', ''),
    coalesce(p_project->>'card_address', ''),
    coalesce(p_project->>'price', ''),
    coalesce(p_project->>'short_description', ''),
    coalesce(p_project->>'full_description', ''),
    coalesce(p_project->>'intro_title', ''),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_project->'categories', '[]'::jsonb))), '{}'::text[]),
    coalesce(p_project->>'status', 'draft')::public.project_status,
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
    coalesce((p_project->>'hero_focal_x')::numeric, 50),
    coalesce((p_project->>'hero_focal_y')::numeric, 50),
    coalesce(p_project->>'intro_image_url', ''),
    nullif(p_project->>'brochure_url', ''),
    coalesce(p_project->>'map_query', ''),
    coalesce(p_project->>'map_url', ''),
    coalesce(p_project->'characteristics', '[]'::jsonb),
    coalesce(p_project->'benefits', '[]'::jsonb),
    coalesce(p_project->'floor_plan_groups', '[]'::jsonb),
    coalesce(p_project->'nearby_places', '[]'::jsonb),
    coalesce(p_project->>'seo_title', ''),
    coalesce(p_project->>'seo_description', '')
  )
  on conflict (id) do update set
    slug = excluded.slug,
    title = excluded.title,
    address = excluded.address,
    card_address = case
      when p_project ? 'card_address' then excluded.card_address
      else projects.card_address
    end,
    price = excluded.price,
    short_description = excluded.short_description,
    full_description = excluded.full_description,
    intro_title = excluded.intro_title,
    categories = excluded.categories,
    status = excluded.status,
    sort_order = excluded.sort_order,
    cover_url = excluded.cover_url,
    cover_focal_x = excluded.cover_focal_x,
    cover_focal_y = excluded.cover_focal_y,
    image_variants = case
      when p_project ? 'image_variants' then excluded.image_variants
      else projects.image_variants
    end,
    hero_type = excluded.hero_type,
    hero_variant = excluded.hero_variant,
    hero_sound_enabled = excluded.hero_sound_enabled,
    hero_idle_ui = excluded.hero_idle_ui,
    hero_url = excluded.hero_url,
    hero_mobile_url = case
      when p_project ? 'hero_mobile_url' then excluded.hero_mobile_url
      else projects.hero_mobile_url
    end,
    hero_poster_url = excluded.hero_poster_url,
    hero_focal_x = excluded.hero_focal_x,
    hero_focal_y = excluded.hero_focal_y,
    intro_image_url = excluded.intro_image_url,
    brochure_url = excluded.brochure_url,
    map_query = excluded.map_query,
    map_url = case
      when p_project ? 'map_url' then excluded.map_url
      else projects.map_url
    end,
    characteristics = excluded.characteristics,
    benefits = excluded.benefits,
    floor_plan_groups = excluded.floor_plan_groups,
    nearby_places = excluded.nearby_places,
    seo_title = excluded.seo_title,
    seo_description = excluded.seo_description;

  delete from public.project_images where project_id = v_project_id;

  insert into public.project_images (
    id,
    project_id,
    url,
    storage_path,
    alt,
    role,
    sort_order,
    width,
    height,
    focal_x,
    focal_y
  )
  select
    image.id,
    v_project_id,
    image.url,
    image.storage_path,
    coalesce(image.alt, ''),
    image.role::public.project_image_role,
    coalesce(image.sort_order, 0),
    image.width,
    image.height,
    coalesce(image.focal_x, 50),
    coalesce(image.focal_y, 50)
  from jsonb_to_recordset(coalesce(p_images, '[]'::jsonb)) as image(
    id text,
    url text,
    storage_path text,
    alt text,
    role text,
    sort_order integer,
    width integer,
    height integer,
    focal_x numeric,
    focal_y numeric
  );
end;
$$;

revoke execute on function public.save_project_with_images(jsonb, jsonb) from public, anon;
grant execute on function public.save_project_with_images(jsonb, jsonb) to authenticated;

create or replace function public.reorder_projects(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  item record;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  for item in
    select *
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as value(id text, sort_order integer)
  loop
    update public.projects as project
    set sort_order = item.sort_order
    where project.id = item.id;
  end loop;
end;
$$;

revoke execute on function public.reorder_projects(jsonb) from public, anon;
grant execute on function public.reorder_projects(jsonb) to authenticated;

create or replace function public.delete_project(p_project_id text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if p_project_id is null or btrim(p_project_id) = '' then
    raise exception 'Project id is required' using errcode = '22023';
  end if;

  delete from public.projects as project
  where project.id = p_project_id;
end;
$$;

revoke execute on function public.delete_project(text) from public, anon;
grant execute on function public.delete_project(text) to authenticated;

create or replace function public.replace_homepage_videos(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_incoming_urls text[];
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct incoming.url), '{}'::text[])
  into v_incoming_urls
  from (
    select value #>> '{}' as url
    from jsonb_path_query(
      coalesce(p_items, '[]'::jsonb),
      '$.** ? (@.type() == "string")'
    ) as item_value(value)
  ) as incoming
  where nullif(incoming.url, '') is not null;

  perform pg_advisory_xact_lock(tracked.lock_key)
  from (
    select distinct hashtextextended(variant.url, 0) as lock_key
    from public.media_variants as variant
    where variant.url = any(v_incoming_urls)
  ) as tracked
  order by tracked.lock_key;

  if exists (
    select 1
    from public.media_variants as variant
    where variant.url = any(v_incoming_urls)
      and variant.deleted_at is not null
  ) then
    raise exception 'A homepage video URL points to a tombstoned media variant' using errcode = '22023';
  end if;

  delete from public.homepage_videos;

  insert into public.homepage_videos (
    id,
    title,
    project_id,
    desktop_url,
    desktop_storage_path,
    mobile_url,
    mobile_storage_path,
    sort_order,
    is_active
  )
  select
    item.id,
    coalesce(item.title, ''),
    nullif(item.project_id, ''),
    coalesce(item.desktop_url, ''),
    nullif(item.desktop_storage_path, ''),
    nullif(item.mobile_url, ''),
    nullif(item.mobile_storage_path, ''),
    coalesce(item.sort_order, 0),
    coalesce(item.is_active, true)
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as item(
    id text,
    title text,
    project_id text,
    desktop_url text,
    desktop_storage_path text,
    mobile_url text,
    mobile_storage_path text,
    sort_order integer,
    is_active boolean
  );
end;
$$;

revoke execute on function public.replace_homepage_videos(jsonb) from public, anon;
grant execute on function public.replace_homepage_videos(jsonb) to authenticated;

grant select on table
  public.projects,
  public.project_images,
  public.homepage_videos
to authenticated;

revoke insert, update, delete on table
  public.projects,
  public.project_images,
  public.homepage_videos
from authenticated;

create or replace function public.queue_media_processing(
  p_source_path text,
  p_mime_type text,
  p_source_size_bytes bigint default null,
  p_requested_variants jsonb default '[]'::jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_max_attempts integer default 3
)
returns table (asset_id uuid, job_id uuid)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_asset_id uuid;
  v_job_id uuid;
  v_media_type text;
  v_mime_type text;
  v_source_size_bytes bigint;
  v_stored_size_bytes bigint;
  v_output_bucket text;
  v_storage_metadata jsonb;
  v_requested_variants jsonb;
  v_metadata jsonb;
  v_job_payload jsonb;
  v_existing_asset public.media_assets%rowtype;
  v_existing_job public.media_processing_jobs%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if p_source_path is null or btrim(p_source_path) = '' then
    raise exception 'Source path is required' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_requested_variants, 'null'::jsonb)) <> 'array' then
    raise exception 'Requested variants must be a JSON array' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_metadata, 'null'::jsonb)) <> 'object' then
    raise exception 'Metadata must be a JSON object' using errcode = '22023';
  end if;

  if p_max_attempts is null or p_max_attempts not between 1 and 20 then
    raise exception 'Max attempts must be between 1 and 20' using errcode = '22023';
  end if;

  select object.metadata
  into v_storage_metadata
  from storage.objects as object
  where object.bucket_id = 'media-sources'
    and object.name = p_source_path;

  if not found then
    raise exception 'Media source does not exist' using errcode = '22023';
  end if;

  v_mime_type := lower(coalesce(
    nullif(p_mime_type, ''),
    nullif(v_storage_metadata->>'mimetype', '')
  ));

  if v_mime_type is null
    or v_mime_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/avif', 'video/mp4') then
    raise exception 'Unsupported media source MIME type' using errcode = '22023';
  end if;

  if nullif(v_storage_metadata->>'mimetype', '') is not null
    and lower(v_storage_metadata->>'mimetype') <> v_mime_type then
    raise exception 'Media source MIME type does not match the stored object' using errcode = '22023';
  end if;

  if coalesce(v_storage_metadata->>'size', '') ~ '^[0-9]+$' then
    v_stored_size_bytes := (v_storage_metadata->>'size')::bigint;
  end if;

  if p_source_size_bytes is not null
    and v_stored_size_bytes is not null
    and p_source_size_bytes <> v_stored_size_bytes then
    raise exception 'Media source size does not match the stored object' using errcode = '22023';
  end if;

  v_source_size_bytes := coalesce(v_stored_size_bytes, p_source_size_bytes);
  if v_source_size_bytes is not null and v_source_size_bytes not between 1 and 209715200 then
    raise exception 'Media source size must be between 1 byte and 200 MiB' using errcode = '22023';
  end if;

  v_media_type := case when v_mime_type like 'image/%' then 'image' else 'video' end;

  if v_media_type = 'image'
    and (v_source_size_bytes is null or v_source_size_bytes > 20971520) then
    raise exception 'Image source size must be known and no larger than 20 MiB' using errcode = '22023';
  end if;

  if v_media_type = 'video'
    and (v_source_size_bytes is null or v_source_size_bytes > 52428800) then
    raise exception 'Video source size must be known and no larger than 50 MiB' using errcode = '22023';
  end if;

  if coalesce(p_metadata, '{}'::jsonb) ? 'output_bucket' then
    if jsonb_typeof(p_metadata->'output_bucket') <> 'string'
      or nullif(btrim(p_metadata->>'output_bucket'), '') is null then
      raise exception 'Metadata output_bucket must be a non-empty string' using errcode = '22023';
    end if;
  end if;

  v_output_bucket := coalesce(p_metadata->>'output_bucket', 'project-media');
  if (v_media_type = 'image' and v_output_bucket <> 'project-media')
    or (v_media_type = 'video' and v_output_bucket not in ('project-media', 'site-media')) then
    raise exception 'Metadata output_bucket is not allowed for this media type' using errcode = '22023';
  end if;

  v_requested_variants := p_requested_variants;
  v_metadata := p_metadata || jsonb_build_object('output_bucket', v_output_bucket);
  v_job_payload := jsonb_build_object('requested_variants', v_requested_variants);

  perform pg_advisory_xact_lock(
    hashtextextended('media-sources/' || p_source_path, 0)
  );

  insert into public.media_assets (
    source_bucket,
    source_path,
    media_type,
    mime_type,
    source_size_bytes,
    requested_variants,
    metadata,
    created_by
  )
  values (
    'media-sources',
    p_source_path,
    v_media_type,
    v_mime_type,
    v_source_size_bytes,
    v_requested_variants,
    v_metadata,
    auth.uid()
  )
  on conflict (source_bucket, source_path) do nothing
  returning id into v_asset_id;

  if v_asset_id is null then
    select asset.*
    into v_existing_asset
    from public.media_assets as asset
    where asset.source_bucket = 'media-sources'
      and asset.source_path = p_source_path;

    if not found then
      raise exception 'Media source queue state could not be resolved' using errcode = '40001';
    end if;

    select job.*
    into v_existing_job
    from public.media_processing_jobs as job
    where job.asset_id = v_existing_asset.id;

    if not found then
      raise exception 'Media source already exists without a processing job' using errcode = '55000';
    end if;

    if v_existing_asset.media_type is distinct from v_media_type
      or v_existing_asset.mime_type is distinct from v_mime_type
      or v_existing_asset.source_size_bytes is distinct from v_source_size_bytes
      or v_existing_asset.requested_variants is distinct from v_requested_variants
      or v_existing_asset.metadata is distinct from v_metadata
      or v_existing_job.max_attempts is distinct from p_max_attempts
      or v_existing_job.payload is distinct from v_job_payload then
      raise exception 'Media source is already queued with different processing parameters'
        using errcode = '22023';
    end if;

    return query select v_existing_asset.id, v_existing_job.id;
    return;
  end if;

  insert into public.media_processing_jobs (
    asset_id,
    max_attempts,
    payload
  )
  values (
    v_asset_id,
    p_max_attempts,
    v_job_payload
  )
  returning id into v_job_id;

  return query select v_asset_id, v_job_id;
end;
$$;

create or replace function public.register_public_media_asset(
  p_bucket_id text,
  p_object_path text,
  p_url text,
  p_mime_type text,
  p_size_bytes bigint
)
returns table (asset_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_mime_type text := lower(nullif(btrim(p_mime_type), ''));
  v_media_type text;
  v_max_size_bytes bigint;
  v_storage_metadata jsonb;
  v_stored_mime_type text;
  v_stored_size_bytes bigint;
  v_asset_id uuid;
  v_existing_asset public.media_assets%rowtype;
  v_existing_variant public.media_variants%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if p_object_path is null or btrim(p_object_path) = '' then
    raise exception 'Object path is required' using errcode = '22023';
  end if;

  if p_url is null or btrim(p_url) = '' then
    raise exception 'Public URL is required' using errcode = '22023';
  end if;

  if p_bucket_id = 'project-media' and v_mime_type = 'image/svg+xml' then
    v_media_type := 'image';
    v_max_size_bytes := 2097152;
  elsif p_bucket_id = 'project-documents' and v_mime_type = 'application/pdf' then
    v_media_type := 'document';
    v_max_size_bytes := 26214400;
  else
    raise exception 'Unsupported public media bucket and MIME type' using errcode = '22023';
  end if;

  if p_size_bytes is null or p_size_bytes not between 1 and v_max_size_bytes then
    raise exception 'Public media size is outside the allowed range' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_bucket_id || '/' || p_object_path, 0)
  );

  select object.metadata
  into v_storage_metadata
  from storage.objects as object
  where object.bucket_id = p_bucket_id
    and object.name = p_object_path;

  if not found then
    raise exception 'Public media object does not exist' using errcode = '22023';
  end if;

  v_stored_mime_type := lower(nullif(btrim(v_storage_metadata->>'mimetype'), ''));
  if v_stored_mime_type is null or v_stored_mime_type <> v_mime_type then
    raise exception 'Public media MIME type does not match the stored object' using errcode = '22023';
  end if;

  if coalesce(v_storage_metadata->>'size', '') !~ '^[0-9]+$' then
    raise exception 'Public media object size is unavailable' using errcode = '22023';
  end if;

  begin
    v_stored_size_bytes := (v_storage_metadata->>'size')::bigint;
  exception
    when numeric_value_out_of_range then
      raise exception 'Public media object size is invalid' using errcode = '22023';
  end;

  if v_stored_size_bytes <> p_size_bytes then
    raise exception 'Public media size does not match the stored object' using errcode = '22023';
  end if;

  select asset.*
  into v_existing_asset
  from public.media_assets as asset
  where asset.source_bucket = p_bucket_id
    and asset.source_path = p_object_path;

  if found then
    if v_existing_asset.media_type is distinct from v_media_type
      or v_existing_asset.mime_type is distinct from v_mime_type
      or v_existing_asset.source_size_bytes is distinct from p_size_bytes
      or v_existing_asset.requested_variants is distinct from '[]'::jsonb
      or v_existing_asset.metadata is distinct from '{}'::jsonb
      or v_existing_asset.status <> 'ready'
      or v_existing_asset.result is distinct from '{}'::jsonb
      or v_existing_asset.last_error is not null
      or v_existing_asset.processed_at is null
      or v_existing_asset.source_deleted_at is null
      or exists (
        select 1
        from public.media_processing_jobs as job
        where job.asset_id = v_existing_asset.id
      ) then
      raise exception 'Public media object is already registered with different parameters'
        using errcode = '22023';
    end if;

    select variant.*
    into v_existing_variant
    from public.media_variants as variant
    where variant.asset_id = v_existing_asset.id
      and variant.variant_key = 'direct';

    if not found
      or v_existing_variant.bucket_id is distinct from p_bucket_id
      or v_existing_variant.object_path is distinct from p_object_path
      or v_existing_variant.url is distinct from p_url
      or v_existing_variant.mime_type is distinct from v_mime_type
      or v_existing_variant.width is not null
      or v_existing_variant.height is not null
      or v_existing_variant.size_bytes is distinct from p_size_bytes
      or v_existing_variant.metadata is distinct from '{"direct":true}'::jsonb
      or v_existing_variant.deleted_at is not null
      or v_existing_variant.storage_deleted_at is not null
      or exists (
        select 1
        from public.media_variants as variant
        where variant.asset_id = v_existing_asset.id
          and variant.id <> v_existing_variant.id
      ) then
      raise exception 'Public media object is already registered with different parameters'
        using errcode = '22023';
    end if;

    return query select v_existing_asset.id;
    return;
  end if;

  if exists (
    select 1
    from public.media_variants as variant
    where variant.bucket_id = p_bucket_id
      and variant.object_path = p_object_path
  ) then
    raise exception 'Public media object is already registered with different parameters'
      using errcode = '22023';
  end if;

  insert into public.media_assets (
    source_bucket,
    source_path,
    media_type,
    mime_type,
    source_size_bytes,
    requested_variants,
    metadata,
    status,
    result,
    created_by,
    processed_at,
    source_deleted_at
  )
  values (
    p_bucket_id,
    p_object_path,
    v_media_type,
    v_mime_type,
    p_size_bytes,
    '[]'::jsonb,
    '{}'::jsonb,
    'ready',
    '{}'::jsonb,
    auth.uid(),
    now(),
    now()
  )
  returning id into v_asset_id;

  insert into public.media_variants (
    asset_id,
    variant_key,
    bucket_id,
    object_path,
    url,
    mime_type,
    size_bytes,
    metadata
  )
  values (
    v_asset_id,
    'direct',
    p_bucket_id,
    p_object_path,
    p_url,
    v_mime_type,
    p_size_bytes,
    '{"direct":true}'::jsonb
  );

  return query select v_asset_id;
end;
$$;

create or replace function public.claim_media_processing_jobs(
  p_limit integer default 1,
  p_lease_seconds integer default 300
)
returns table (
  job_id uuid,
  asset_id uuid,
  lease_token uuid,
  attempt_count integer,
  max_attempts integer,
  source_bucket text,
  source_path text,
  media_type text,
  mime_type text,
  source_size_bytes bigint,
  requested_variants jsonb,
  metadata jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 1), 1), 100);
  v_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 300), 30), 3600);
begin
  with exhausted as (
    update public.media_processing_jobs as job
    set
      status = 'failed',
      lease_token = null,
      leased_at = null,
      lease_expires_at = null,
      last_error = coalesce(job.last_error, 'Processing lease expired after the final attempt'),
      completed_at = now()
    where job.status = 'processing'
      and job.lease_expires_at <= now()
      and job.attempt_count >= job.max_attempts
    returning job.asset_id, job.last_error
  )
  update public.media_assets as asset
  set
    status = 'failed',
    last_error = coalesce(exhausted.last_error, 'Processing lease expired after the final attempt'),
    processed_at = now()
  from exhausted
  where asset.id = exhausted.asset_id;

  return query
  with candidates as (
    select job.id
    from public.media_processing_jobs as job
    where (
      (job.status = 'queued' and job.available_at <= now())
      or (job.status = 'processing' and job.lease_expires_at <= now())
    )
      and job.attempt_count < job.max_attempts
    order by job.available_at, job.created_at
    limit v_limit
    for update skip locked
  ),
  claimed as (
    update public.media_processing_jobs as job
    set
      status = 'processing',
      attempt_count = job.attempt_count + 1,
      lease_token = gen_random_uuid(),
      leased_at = now(),
      lease_expires_at = now() + make_interval(secs => v_lease_seconds),
      last_error = null,
      completed_at = null
    from candidates
    where job.id = candidates.id
    returning job.*
  ),
  updated_assets as (
    update public.media_assets as asset
    set
      status = 'processing',
      last_error = null,
      processed_at = null
    where asset.id in (select claimed.asset_id from claimed)
    returning asset.id
  )
  select
    claimed.id,
    claimed.asset_id,
    claimed.lease_token,
    claimed.attempt_count,
    claimed.max_attempts,
    asset.source_bucket,
    asset.source_path,
    asset.media_type,
    asset.mime_type,
    asset.source_size_bytes,
    asset.requested_variants,
    asset.metadata
  from claimed
  join updated_assets on updated_assets.id = claimed.asset_id
  join public.media_assets as asset on asset.id = claimed.asset_id
  order by claimed.available_at, claimed.created_at;
end;
$$;

create or replace function public.renew_media_processing_lease(
  p_job_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 300
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expires_at timestamptz;
  v_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 300), 30), 3600);
begin
  update public.media_processing_jobs as job
  set lease_expires_at = now() + make_interval(secs => v_lease_seconds)
  where job.id = p_job_id
    and job.status = 'processing'
    and job.lease_token = p_lease_token
    and job.lease_expires_at > now()
  returning job.lease_expires_at into v_expires_at;

  if not found then
    raise exception 'Active media processing lease not found' using errcode = 'P0002';
  end if;

  return v_expires_at;
end;
$$;

create or replace function public.complete_media_processing_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_variants jsonb,
  p_result jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.media_processing_jobs%rowtype;
  v_result jsonb;
  v_invalid_variants integer;
begin
  if p_variants is null or jsonb_typeof(p_variants) <> 'array' then
    raise exception 'Variants must be a non-empty JSON array' using errcode = '22023';
  end if;

  if jsonb_array_length(p_variants) = 0 then
    raise exception 'Variants must be a non-empty JSON array' using errcode = '22023';
  end if;

  v_result := coalesce(p_result, '{}'::jsonb);
  if jsonb_typeof(v_result) <> 'object' then
    raise exception 'Result must be a JSON object' using errcode = '22023';
  end if;

  select job.*
  into v_job
  from public.media_processing_jobs as job
  where job.id = p_job_id
  for update;

  if not found then
    raise exception 'Media processing job not found' using errcode = 'P0002';
  end if;

  if v_job.status <> 'processing'
    or v_job.lease_token is distinct from p_lease_token
    or v_job.lease_expires_at <= now() then
    raise exception 'Active media processing lease not found' using errcode = 'P0002';
  end if;

  select count(*)
  into v_invalid_variants
  from jsonb_to_recordset(p_variants) as variant(
    variant_key text,
    bucket_id text,
    object_path text,
    url text,
    mime_type text,
    width integer,
    height integer,
    size_bytes bigint,
    metadata jsonb
  )
  where nullif(btrim(variant.variant_key), '') is null
    or nullif(btrim(variant.bucket_id), '') is null
    or nullif(btrim(variant.object_path), '') is null
    or nullif(btrim(variant.url), '') is null
    or nullif(btrim(variant.mime_type), '') is null
    or (variant.width is not null and variant.width <= 0)
    or (variant.height is not null and variant.height <= 0)
    or (variant.size_bytes is not null and variant.size_bytes <= 0)
    or (variant.metadata is not null and jsonb_typeof(variant.metadata) <> 'object');

  if v_invalid_variants > 0 then
    raise exception 'One or more media variants are invalid' using errcode = '22023';
  end if;

  insert into public.media_variants (
    asset_id,
    variant_key,
    bucket_id,
    object_path,
    url,
    mime_type,
    width,
    height,
    size_bytes,
    metadata
  )
  select
    v_job.asset_id,
    variant.variant_key,
    variant.bucket_id,
    variant.object_path,
    variant.url,
    variant.mime_type,
    variant.width,
    variant.height,
    variant.size_bytes,
    coalesce(variant.metadata, '{}'::jsonb)
  from jsonb_to_recordset(p_variants) as variant(
    variant_key text,
    bucket_id text,
    object_path text,
    url text,
    mime_type text,
    width integer,
    height integer,
    size_bytes bigint,
    metadata jsonb
  );

  v_result := v_result || jsonb_build_object('variants', p_variants);

  update public.media_processing_jobs as job
  set
    status = 'completed',
    lease_token = null,
    leased_at = null,
    lease_expires_at = null,
    result = v_result,
    last_error = null,
    completed_at = now()
  where job.id = v_job.id;

  update public.media_assets as asset
  set
    status = 'ready',
    result = v_result,
    last_error = null,
    processed_at = now()
  where asset.id = v_job.asset_id;
end;
$$;

create or replace function public.fail_media_processing_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_error text,
  p_retryable boolean,
  p_retry_delay_seconds integer default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.media_processing_jobs%rowtype;
  v_retry boolean;
  v_retry_delay_seconds integer;
  v_error text := coalesce(nullif(btrim(p_error), ''), 'Media processing failed');
begin
  select job.*
  into v_job
  from public.media_processing_jobs as job
  where job.id = p_job_id
  for update;

  if not found then
    raise exception 'Media processing job not found' using errcode = 'P0002';
  end if;

  if v_job.status <> 'processing'
    or v_job.lease_token is distinct from p_lease_token
    or v_job.lease_expires_at <= now() then
    raise exception 'Active media processing lease not found' using errcode = 'P0002';
  end if;

  if p_retryable is null then
    raise exception 'Retryable must be specified' using errcode = '22023';
  end if;

  v_retry := p_retryable and v_job.attempt_count < v_job.max_attempts;
  v_retry_delay_seconds := case
    when p_retry_delay_seconds is not null
      then least(greatest(p_retry_delay_seconds, 0), 86400)
    else least(3600, (30 * power(2, greatest(v_job.attempt_count - 1, 0)))::integer)
  end;

  if v_retry then
    update public.media_processing_jobs as job
    set
      status = 'queued',
      available_at = now() + make_interval(secs => v_retry_delay_seconds),
      lease_token = null,
      leased_at = null,
      lease_expires_at = null,
      last_error = v_error,
      completed_at = null
    where job.id = v_job.id;

    update public.media_assets as asset
    set
      status = 'queued',
      last_error = v_error,
      processed_at = null
    where asset.id = v_job.asset_id;
  else
    update public.media_processing_jobs as job
    set
      status = 'failed',
      lease_token = null,
      leased_at = null,
      lease_expires_at = null,
      last_error = v_error,
      completed_at = now()
    where job.id = v_job.id;

    update public.media_assets as asset
    set
      status = 'failed',
      last_error = v_error,
      processed_at = now()
    where asset.id = v_job.asset_id;
  end if;

  return v_retry;
end;
$$;

create or replace function public.get_media_cleanup_candidates(
  p_before timestamptz default now() - interval '7 days',
  p_limit integer default 100
)
returns table (
  variant_id uuid,
  asset_id uuid,
  bucket_id text,
  object_path text,
  url text,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz,
  deleted_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 1000);
begin
  return query
  select
    variant.id,
    variant.asset_id,
    variant.bucket_id,
    variant.object_path,
    variant.url,
    variant.mime_type,
    variant.size_bytes,
    variant.created_at,
    variant.deleted_at
  from public.media_variants as variant
  join public.media_assets as asset on asset.id = variant.asset_id
  where variant.storage_deleted_at is null
    and (
      variant.deleted_at is not null
      or (
        asset.status = 'ready'
        and variant.created_at < least(coalesce(p_before, now()), now())
        and not exists (
          select 1
          from public.media_reference_urls as reference
          where reference.url = variant.url
        )
      )
    )
  order by coalesce(variant.deleted_at, variant.created_at), variant.id
  limit v_limit;
end;
$$;

create or replace function public.tombstone_media_variants(p_variant_ids uuid[])
returns table (
  variant_id uuid,
  asset_id uuid,
  bucket_id text,
  object_path text,
  url text,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz,
  deleted_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_variant_ids is null or cardinality(p_variant_ids) = 0 then
    raise exception 'At least one media variant id is required' using errcode = '22023';
  end if;

  if cardinality(p_variant_ids) > 1000 then
    raise exception 'At most 1000 media variants can be tombstoned at once' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(candidate.lock_key)
  from (
    select distinct hashtextextended(variant.url, 0) as lock_key
    from public.media_variants as variant
    where variant.id = any(p_variant_ids)
      and variant.storage_deleted_at is null
  ) as candidate
  order by candidate.lock_key;

  return query
  with approved as (
    update public.media_variants as variant
    set deleted_at = coalesce(variant.deleted_at, now())
    where variant.id = any(p_variant_ids)
      and variant.storage_deleted_at is null
      and (
        variant.deleted_at is not null
        or exists (
          select 1
          from public.media_assets as asset
          where asset.id = variant.asset_id
            and asset.status = 'ready'
        )
      )
      and not exists (
        select 1
        from public.media_reference_urls as reference
        where reference.url = variant.url
      )
    returning variant.*
  )
  select
    approved.id,
    approved.asset_id,
    approved.bucket_id,
    approved.object_path,
    approved.url,
    approved.mime_type,
    approved.size_bytes,
    approved.created_at,
    approved.deleted_at
  from approved
  order by approved.created_at, approved.id;
end;
$$;

create or replace function public.mark_media_variants_deleted(p_variant_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_variant_ids is null or cardinality(p_variant_ids) = 0 then
    raise exception 'At least one media variant id is required' using errcode = '22023';
  end if;

  if cardinality(p_variant_ids) > 1000 then
    raise exception 'At most 1000 media variants can be marked at once' using errcode = '22023';
  end if;

  update public.media_variants as variant
  set storage_deleted_at = now()
  where variant.id = any(p_variant_ids)
    and variant.deleted_at is not null
    and variant.storage_deleted_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.get_media_source_cleanup_candidates(
  p_before timestamptz default now() - interval '7 days',
  p_limit integer default 100
)
returns table (
  asset_id uuid,
  source_bucket text,
  source_path text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 1000);
begin
  return query
  select
    asset.id,
    asset.source_bucket,
    asset.source_path
  from public.media_assets as asset
  where asset.source_deleted_at is null
    and asset.status in ('ready', 'failed')
    and coalesce(asset.processed_at, asset.updated_at) < least(coalesce(p_before, now()), now())
    and not exists (
      select 1
      from public.media_processing_jobs as job
      where job.asset_id = asset.id
        and job.status in ('queued', 'processing')
    )
  order by coalesce(asset.processed_at, asset.updated_at), asset.id
  limit v_limit;
end;
$$;

create or replace function public.mark_media_sources_deleted(p_asset_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_asset_ids is null or cardinality(p_asset_ids) = 0 then
    raise exception 'At least one media asset id is required' using errcode = '22023';
  end if;

  if cardinality(p_asset_ids) > 1000 then
    raise exception 'At most 1000 media sources can be marked at once' using errcode = '22023';
  end if;

  update public.media_assets as asset
  set source_deleted_at = now()
  where asset.id = any(p_asset_ids)
    and asset.source_deleted_at is null
    and asset.status in ('ready', 'failed')
    and not exists (
      select 1
      from public.media_processing_jobs as job
      where job.asset_id = asset.id
        and job.status in ('queued', 'processing')
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.queue_media_processing(text, text, bigint, jsonb, jsonb, integer)
from public, anon;
grant execute on function public.queue_media_processing(text, text, bigint, jsonb, jsonb, integer)
to authenticated;

revoke execute on function public.register_public_media_asset(text, text, text, text, bigint)
from public, anon;
grant execute on function public.register_public_media_asset(text, text, text, text, bigint)
to authenticated;

revoke execute on function public.claim_media_processing_jobs(integer, integer)
from public, anon, authenticated;
revoke execute on function public.renew_media_processing_lease(uuid, uuid, integer)
from public, anon, authenticated;
revoke execute on function public.complete_media_processing_job(uuid, uuid, jsonb, jsonb)
from public, anon, authenticated;
revoke execute on function public.fail_media_processing_job(uuid, uuid, text, boolean, integer)
from public, anon, authenticated;
revoke execute on function public.get_media_cleanup_candidates(timestamptz, integer)
from public, anon, authenticated;
revoke execute on function public.tombstone_media_variants(uuid[])
from public, anon, authenticated;
revoke execute on function public.mark_media_variants_deleted(uuid[])
from public, anon, authenticated;
revoke execute on function public.get_media_source_cleanup_candidates(timestamptz, integer)
from public, anon, authenticated;
revoke execute on function public.mark_media_sources_deleted(uuid[])
from public, anon, authenticated;

grant execute on function public.claim_media_processing_jobs(integer, integer)
to service_role;
grant execute on function public.renew_media_processing_lease(uuid, uuid, integer)
to service_role;
grant execute on function public.complete_media_processing_job(uuid, uuid, jsonb, jsonb)
to service_role;
grant execute on function public.fail_media_processing_job(uuid, uuid, text, boolean, integer)
to service_role;
grant execute on function public.get_media_cleanup_candidates(timestamptz, integer)
to service_role;
grant execute on function public.tombstone_media_variants(uuid[])
to service_role;
grant execute on function public.mark_media_variants_deleted(uuid[])
to service_role;
grant execute on function public.get_media_source_cleanup_candidates(timestamptz, integer)
to service_role;
grant execute on function public.mark_media_sources_deleted(uuid[])
to service_role;

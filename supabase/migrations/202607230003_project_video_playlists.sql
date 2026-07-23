alter table public.projects
  add column if not exists hero_videos jsonb not null default '[]'::jsonb,
  add column if not exists walkthrough_videos jsonb not null default '[]'::jsonb;

alter table public.projects
  drop constraint if exists projects_hero_videos_array_check,
  drop constraint if exists projects_walkthrough_videos_array_check;

alter table public.projects
  add constraint projects_hero_videos_array_check
  check (jsonb_typeof(hero_videos) = 'array'),
  add constraint projects_walkthrough_videos_array_check
  check (jsonb_typeof(walkthrough_videos) = 'array');

update public.projects
set hero_videos = jsonb_build_array(jsonb_build_object(
  'id', id || '-hero-1',
  'desktopUrl', hero_url,
  'mobileUrl', hero_mobile_url,
  'posterUrl', hero_poster_url
))
where hero_type = 'video'
  and nullif(hero_url, '') is not null
  and jsonb_array_length(hero_videos) = 0;

update public.projects
set walkthrough_videos = jsonb_build_array(jsonb_build_object(
  'id', id || '-walkthrough-1',
  'desktopUrl', walkthrough_video_desktop_url,
  'mobileUrl', walkthrough_video_mobile_url,
  'posterUrl', walkthrough_video_poster_url
))
where nullif(walkthrough_video_desktop_url, '') is not null
  and jsonb_array_length(walkthrough_videos) = 0;

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
    ('walkthrough_video_desktop_url', project.walkthrough_video_desktop_url),
    ('walkthrough_video_mobile_url', project.walkthrough_video_mobile_url),
    ('walkthrough_video_poster_url', project.walkthrough_video_poster_url),
    ('intro_image_url', project.intro_image_url),
    ('brochure_url', project.brochure_url)
) as reference(reference_key, url)
where nullif(reference.url, '') is not null

union all

select
  'projects'::text,
  project.id::text,
  'hero_videos.' || video.ordinal::text || '.' || reference.reference_key,
  reference.url
from public.projects as project
cross join lateral jsonb_array_elements(project.hero_videos) with ordinality as video(value, ordinal)
cross join lateral (
  values
    ('desktopUrl', video.value->>'desktopUrl'),
    ('mobileUrl', video.value->>'mobileUrl'),
    ('posterUrl', video.value->>'posterUrl')
) as reference(reference_key, url)
where nullif(reference.url, '') is not null

union all

select
  'projects'::text,
  project.id::text,
  'walkthrough_videos.' || video.ordinal::text || '.' || reference.reference_key,
  reference.url
from public.projects as project
cross join lateral jsonb_array_elements(project.walkthrough_videos) with ordinality as video(value, ordinal)
cross join lateral (
  values
    ('desktopUrl', video.value->>'desktopUrl'),
    ('mobileUrl', video.value->>'mobileUrl'),
    ('posterUrl', video.value->>'posterUrl')
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
    hero_videos,
    hero_type,
    hero_variant,
    hero_sound_enabled,
    hero_idle_ui,
    hero_url,
    hero_mobile_url,
    hero_poster_url,
    walkthrough_video_enabled,
    walkthrough_video_title,
    walkthrough_video_desktop_url,
    walkthrough_video_mobile_url,
    walkthrough_video_poster_url,
    walkthrough_videos,
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
    coalesce(nullif(p_project->'hero_videos', 'null'::jsonb), '[]'::jsonb),
    coalesce(p_project->>'hero_type', 'image'),
    coalesce(p_project->>'hero_variant', 'standard'),
    coalesce((p_project->>'hero_sound_enabled')::boolean, false),
    coalesce((p_project->>'hero_idle_ui')::boolean, false),
    coalesce(p_project->>'hero_url', ''),
    nullif(p_project->>'hero_mobile_url', ''),
    nullif(p_project->>'hero_poster_url', ''),
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
    hero_videos = case
      when p_project ? 'hero_videos' then excluded.hero_videos
      when p_project ? 'hero_url' then
        case
          when excluded.hero_type = 'video' then
            case
              when nullif(excluded.hero_url, '') is not null
              then jsonb_build_array(jsonb_build_object(
                'id', coalesce(projects.hero_videos->0->>'id', projects.id || '-hero-1'),
                'desktopUrl', excluded.hero_url,
                'mobileUrl', excluded.hero_mobile_url,
                'posterUrl', excluded.hero_poster_url
              )) || (projects.hero_videos - 0)
              else '[]'::jsonb
            end
          else projects.hero_videos
        end
      else projects.hero_videos
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
    walkthrough_video_enabled = case
      when p_project ? 'walkthrough_video_enabled' then excluded.walkthrough_video_enabled
      else projects.walkthrough_video_enabled
    end,
    walkthrough_video_title = case
      when p_project ? 'walkthrough_video_title' then excluded.walkthrough_video_title
      else projects.walkthrough_video_title
    end,
    walkthrough_video_desktop_url = case
      when p_project ? 'walkthrough_video_desktop_url' then excluded.walkthrough_video_desktop_url
      else projects.walkthrough_video_desktop_url
    end,
    walkthrough_video_mobile_url = case
      when p_project ? 'walkthrough_video_mobile_url' then excluded.walkthrough_video_mobile_url
      else projects.walkthrough_video_mobile_url
    end,
    walkthrough_video_poster_url = case
      when p_project ? 'walkthrough_video_poster_url' then excluded.walkthrough_video_poster_url
      else projects.walkthrough_video_poster_url
    end,
    walkthrough_videos = case
      when p_project ? 'walkthrough_videos' then excluded.walkthrough_videos
      when p_project ? 'walkthrough_video_desktop_url' then
        case
          when nullif(excluded.walkthrough_video_desktop_url, '') is not null
          then jsonb_build_array(jsonb_build_object(
            'id', coalesce(projects.walkthrough_videos->0->>'id', projects.id || '-walkthrough-1'),
            'desktopUrl', excluded.walkthrough_video_desktop_url,
            'mobileUrl', excluded.walkthrough_video_mobile_url,
            'posterUrl', excluded.walkthrough_video_poster_url
          )) || (projects.walkthrough_videos - 0)
          else '[]'::jsonb
        end
      else projects.walkthrough_videos
    end,
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

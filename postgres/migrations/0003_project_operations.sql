create function miracon.save_project_with_images(
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
    id, slug, title, address, card_address, price, short_description, full_description,
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

revoke execute on function miracon.save_project_with_images(jsonb, jsonb) from public;

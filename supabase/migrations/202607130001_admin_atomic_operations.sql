create or replace function public.save_project_with_images(
  p_project jsonb,
  p_images jsonb default '[]'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_project_id text := p_project->>'id';
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if v_project_id is null or v_project_id = '' then
    raise exception 'Project id is required' using errcode = '22023';
  end if;

  insert into public.projects (
    id,
    slug,
    title,
    address,
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
    hero_type,
    hero_variant,
    hero_sound_enabled,
    hero_idle_ui,
    hero_url,
    hero_poster_url,
    hero_focal_x,
    hero_focal_y,
    intro_image_url,
    brochure_url,
    map_query,
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
    coalesce(p_project->>'hero_type', 'image'),
    coalesce(p_project->>'hero_variant', 'standard'),
    coalesce((p_project->>'hero_sound_enabled')::boolean, false),
    coalesce((p_project->>'hero_idle_ui')::boolean, false),
    coalesce(p_project->>'hero_url', ''),
    nullif(p_project->>'hero_poster_url', ''),
    coalesce((p_project->>'hero_focal_x')::numeric, 50),
    coalesce((p_project->>'hero_focal_y')::numeric, 50),
    coalesce(p_project->>'intro_image_url', ''),
    nullif(p_project->>'brochure_url', ''),
    coalesce(p_project->>'map_query', ''),
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
    hero_type = excluded.hero_type,
    hero_variant = excluded.hero_variant,
    hero_sound_enabled = excluded.hero_sound_enabled,
    hero_idle_ui = excluded.hero_idle_ui,
    hero_url = excluded.hero_url,
    hero_poster_url = excluded.hero_poster_url,
    hero_focal_x = excluded.hero_focal_x,
    hero_focal_y = excluded.hero_focal_y,
    intro_image_url = excluded.intro_image_url,
    brochure_url = excluded.brochure_url,
    map_query = excluded.map_query,
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

create or replace function public.reorder_projects(p_items jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  item record;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  for item in
    select * from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as value(id text, sort_order integer)
  loop
    update public.projects
    set sort_order = item.sort_order
    where id = item.id;
  end loop;
end;
$$;

revoke execute on function public.save_project_with_images(jsonb, jsonb) from public, anon;
revoke execute on function public.reorder_projects(jsonb) from public, anon;
grant execute on function public.save_project_with_images(jsonb, jsonb) to authenticated;
grant execute on function public.reorder_projects(jsonb) to authenticated;

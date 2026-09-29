alter table miracon.projects
  add column virtual_tour_url text not null default '',
  add constraint projects_virtual_tour_url_check check (
    length(virtual_tour_url) <= 2048
    and (virtual_tour_url = '' or virtual_tour_url ~ '^https://[^[:space:]/?#]+([/?#][^[:space:]]*)?$')
  );

-- Existing immutable revisions predate this field; absence means an empty tour link.
-- Keep historical snapshots intact, including their audit-event copies.
create or replace function miracon.is_valid_content_snapshot(
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
        miracon.has_exact_jsonb_keys(p_snapshot, array['aggregateType', 'aggregateId', 'deleted', 'project', 'images'])
        and jsonb_typeof(p_snapshot->'deleted') = 'boolean'
        and jsonb_typeof(p_snapshot->'images') = 'array'
        and (
          (p_snapshot->'deleted' = 'true'::jsonb and p_snapshot->'project' = 'null'::jsonb
            and jsonb_array_length(p_snapshot->'images') = 0)
          or
          (p_snapshot->'deleted' = 'false'::jsonb
            and jsonb_typeof(p_snapshot->'project') = 'object'
            and miracon.has_exact_jsonb_keys((p_snapshot->'project') - 'virtual_tour_url', array[
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
            ])
            and (not (p_snapshot->'project' ? 'virtual_tour_url')
              or (jsonb_typeof(p_snapshot->'project'->'virtual_tour_url') = 'string'
                and length(p_snapshot->'project'->>'virtual_tour_url') <= 2048
                and (p_snapshot->'project'->>'virtual_tour_url' = ''
                  or p_snapshot->'project'->>'virtual_tour_url' ~ '^https://[^[:space:]/?#]+([/?#][^[:space:]]*)?$'))
            )
            and jsonb_typeof(p_snapshot->'project'->'id') = 'string'
            and p_snapshot->'project'->>'id' is not distinct from p_aggregate_id
            and not exists (
              select 1 from jsonb_array_elements(p_snapshot->'images') as image
              where jsonb_typeof(image) <> 'object'
                or not miracon.has_exact_jsonb_keys(image, array[
                  'id', 'project_id', 'url', 'storage_path', 'alt', 'role', 'sort_order',
                  'width', 'height', 'focal_x', 'focal_y', 'created_at'
                ])
                or jsonb_typeof(image->'project_id') is distinct from 'string'
                or image->>'project_id' is distinct from p_aggregate_id
            ))
        )
      when 'homepage_hero' then
        miracon.has_exact_jsonb_keys(p_snapshot, array['aggregateType', 'aggregateId', 'videos'])
        and p_aggregate_id = 'singleton'
        and jsonb_typeof(p_snapshot->'videos') = 'array'
        and not exists (
          select 1 from jsonb_array_elements(p_snapshot->'videos') as video
          where jsonb_typeof(video) <> 'object'
            or not miracon.has_exact_jsonb_keys(video, array[
              'id', 'title', 'project_id', 'desktop_url', 'desktop_storage_path', 'mobile_url',
              'mobile_storage_path', 'sort_order', 'is_active', 'created_at', 'updated_at'
            ])
        )
      when 'site_settings' then
        miracon.has_exact_jsonb_keys(p_snapshot, array['aggregateType', 'aggregateId', 'settings'])
        and p_aggregate_id = 'singleton'
        and jsonb_typeof(p_snapshot->'settings') = 'object'
        and (
          miracon.has_exact_jsonb_keys(p_snapshot->'settings', array[
            'id', 'footer_terms_visible', 'footer_terms_pdf_url', 'footer_privacy_visible',
            'footer_privacy_pdf_url', 'footer_cookie_visible', 'footer_cookie_pdf_url', 'updated_at'
          ])
          or miracon.has_exact_jsonb_keys(p_snapshot->'settings', array[
            'id', 'footer_terms_visible', 'footer_terms_pdf_url', 'footer_privacy_visible',
            'footer_privacy_pdf_url', 'footer_cookie_visible', 'footer_cookie_pdf_url',
            'site_name', 'company_name', 'home_copy', 'golden_visa_copy', 'contact_copy',
            'stages_copy', 'footer_phone', 'footer_email', 'footer_address',
            'facebook_visible', 'facebook_url', 'instagram_visible', 'instagram_url',
            'linkedin_visible', 'linkedin_url', 'whatsapp_visible', 'whatsapp_phone',
            'whatsapp_message', 'updated_at'
          ])
        )
        and jsonb_typeof(p_snapshot->'settings'->'id') = 'number'
        and p_snapshot->'settings'->'id' is not distinct from '1'::jsonb
      else false
    end,
    false
  );
$$;

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
    walkthrough_video_poster_url, walkthrough_videos, virtual_tour_url, hero_focal_x, hero_focal_y,
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
    coalesce(p_project->>'virtual_tour_url', ''),
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
    virtual_tour_url = case when p_project ? 'virtual_tour_url' then excluded.virtual_tour_url else projects.virtual_tour_url end,
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

create or replace function miracon.materialize_content_revision(p_revision_id uuid) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_revision miracon.content_revisions%rowtype;
  v_snapshot jsonb;
  v_previous_context text := current_setting('miracon.exact_revision_materialization', true);
  v_materialized jsonb;
begin
  select * into v_revision from miracon.content_revisions
  where id = p_revision_id and state = 'approved' for update;
  if not found then
    raise exception 'Approved content revision not found' using errcode = '22023';
  end if;
  v_snapshot := v_revision.snapshot;
  perform set_config('miracon.exact_revision_materialization', p_revision_id::text, true);
  begin
    case v_revision.aggregate_type
      when 'project' then
        if (v_snapshot->>'deleted')::boolean then
          perform pg_advisory_xact_lock(hashtextextended('homepage_hero:singleton', 0));
          perform pg_advisory_xact_lock(hashtextextended('miracon.replace_homepage_videos', 0));
          if exists (select 1 from miracon.homepage_videos where project_id = v_revision.aggregate_id) then
            raise exception 'Homepage references project' using errcode = '23503';
          end if;
          delete from miracon.projects where id = v_revision.aggregate_id;
          v_materialized := jsonb_build_object('aggregateType', 'project', 'aggregateId', v_revision.aggregate_id,
            'deleted', true, 'project', null, 'images', jsonb_build_array());
        else
          insert into miracon.projects
          select (jsonb_populate_record(null::miracon.projects, jsonb_build_object('virtual_tour_url', '') || v_snapshot->'project')).*
          on conflict (id) do update set
            slug = excluded.slug, title = excluded.title, address = excluded.address,
            card_address = excluded.card_address, price = excluded.price,
            short_description = excluded.short_description, full_description = excluded.full_description,
            intro_title = excluded.intro_title, categories = excluded.categories, status = excluded.status,
            sort_order = excluded.sort_order, cover_url = excluded.cover_url,
            cover_focal_x = excluded.cover_focal_x, cover_focal_y = excluded.cover_focal_y,
            image_variants = excluded.image_variants, hero_type = excluded.hero_type,
            hero_variant = excluded.hero_variant, hero_sound_enabled = excluded.hero_sound_enabled,
            hero_idle_ui = excluded.hero_idle_ui, hero_url = excluded.hero_url,
            hero_mobile_url = excluded.hero_mobile_url, hero_poster_url = excluded.hero_poster_url,
            hero_videos = excluded.hero_videos, walkthrough_video_enabled = excluded.walkthrough_video_enabled,
            walkthrough_video_title = excluded.walkthrough_video_title,
            walkthrough_video_desktop_url = excluded.walkthrough_video_desktop_url,
            walkthrough_video_mobile_url = excluded.walkthrough_video_mobile_url,
            walkthrough_video_poster_url = excluded.walkthrough_video_poster_url,
            walkthrough_videos = excluded.walkthrough_videos,
            virtual_tour_url = excluded.virtual_tour_url,
            hero_focal_x = excluded.hero_focal_x,
            hero_focal_y = excluded.hero_focal_y, intro_image_url = excluded.intro_image_url,
            brochure_url = excluded.brochure_url, map_query = excluded.map_query, map_url = excluded.map_url,
            characteristics = excluded.characteristics, benefits = excluded.benefits,
            floor_plan_groups = excluded.floor_plan_groups, nearby_places = excluded.nearby_places,
            translations = excluded.translations, seo_title = excluded.seo_title,
            seo_description = excluded.seo_description, published_at = excluded.published_at,
            created_at = excluded.created_at, updated_at = excluded.updated_at,
            remaining_units = excluded.remaining_units;
          delete from miracon.project_images where project_id = v_revision.aggregate_id;
          insert into miracon.project_images
          select * from jsonb_populate_recordset(null::miracon.project_images, v_snapshot->'images');
          select jsonb_build_object('aggregateType', 'project', 'aggregateId', v_revision.aggregate_id,
            'deleted', false, 'project', to_jsonb(project),
            'images', coalesce((select jsonb_agg(to_jsonb(image) order by image.role, image.sort_order, image.id)
              from miracon.project_images as image where image.project_id = project.id), '[]'::jsonb))
          into v_materialized from miracon.projects as project where project.id = v_revision.aggregate_id;
        end if;
      when 'homepage_hero' then
        perform pg_advisory_xact_lock(hashtextextended('miracon.replace_homepage_videos', 0));
        delete from miracon.homepage_videos;
        insert into miracon.homepage_videos
        select * from jsonb_populate_recordset(null::miracon.homepage_videos, v_snapshot->'videos');
        select jsonb_build_object('aggregateType', 'homepage_hero', 'aggregateId', 'singleton',
          'videos', coalesce(jsonb_agg(to_jsonb(video) order by video.sort_order, video.id)
            filter (where video.id is not null), '[]'::jsonb))
        into v_materialized from (select 1) as singleton left join miracon.homepage_videos as video on true;
      when 'site_settings' then
        update miracon.site_settings as settings
        set footer_terms_visible = exact.footer_terms_visible,
            footer_terms_pdf_url = exact.footer_terms_pdf_url,
            footer_privacy_visible = exact.footer_privacy_visible,
            footer_privacy_pdf_url = exact.footer_privacy_pdf_url,
            footer_cookie_visible = exact.footer_cookie_visible,
            footer_cookie_pdf_url = exact.footer_cookie_pdf_url,
            site_name = exact.site_name, company_name = exact.company_name,
            home_copy = exact.home_copy, golden_visa_copy = exact.golden_visa_copy,
            contact_copy = exact.contact_copy, stages_copy = exact.stages_copy,
            footer_phone = exact.footer_phone, footer_email = exact.footer_email,
            footer_address = exact.footer_address,
            facebook_visible = exact.facebook_visible, facebook_url = exact.facebook_url,
            instagram_visible = exact.instagram_visible, instagram_url = exact.instagram_url,
            linkedin_visible = exact.linkedin_visible, linkedin_url = exact.linkedin_url,
            whatsapp_visible = exact.whatsapp_visible, whatsapp_phone = exact.whatsapp_phone,
            whatsapp_message = exact.whatsapp_message,
            updated_at = exact.updated_at
        from jsonb_populate_record(null::miracon.site_settings, v_snapshot->'settings') as exact
        where settings.id = 1;
        select jsonb_build_object('aggregateType', 'site_settings', 'aggregateId', 'singleton',
          'settings', to_jsonb(settings))
        into v_materialized from miracon.site_settings as settings where settings.id = 1;
    end case;
  exception when others then
    perform set_config('miracon.exact_revision_materialization', coalesce(v_previous_context, ''), true);
    raise;
  end;
  perform set_config('miracon.exact_revision_materialization', coalesce(v_previous_context, ''), true);
  return v_materialized;
end;
$$;

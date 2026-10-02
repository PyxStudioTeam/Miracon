-- Separate Greek legal-document publication from the existing English documents.
-- Previous revision snapshots remain immutable and materialize with Greek defaults.
alter table miracon.site_settings
  add column footer_terms_el_visible boolean not null default false,
  add column footer_terms_el_pdf_url text not null default '',
  add column footer_privacy_el_visible boolean not null default false,
  add column footer_privacy_el_pdf_url text not null default '',
  add column footer_cookie_el_visible boolean not null default false,
  add column footer_cookie_el_pdf_url text not null default '';

alter table miracon.site_settings
  add constraint site_settings_footer_terms_el_pdf_url_format check (footer_terms_el_pdf_url = '' or footer_terms_el_pdf_url ~* '^(https://|/media/)'),
  add constraint site_settings_footer_terms_el_visible_requires_pdf check (not footer_terms_el_visible or footer_terms_el_pdf_url <> ''),
  add constraint site_settings_footer_privacy_el_pdf_url_format check (footer_privacy_el_pdf_url = '' or footer_privacy_el_pdf_url ~* '^(https://|/media/)'),
  add constraint site_settings_footer_privacy_el_visible_requires_pdf check (not footer_privacy_el_visible or footer_privacy_el_pdf_url <> ''),
  add constraint site_settings_footer_cookie_el_pdf_url_format check (footer_cookie_el_pdf_url = '' or footer_cookie_el_pdf_url ~* '^(https://|/media/)'),
  add constraint site_settings_footer_cookie_el_visible_requires_pdf check (not footer_cookie_el_visible or footer_cookie_el_pdf_url <> '');

-- Retain each historical exact shape while adding the full localized settings shape.
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
          or miracon.has_exact_jsonb_keys(p_snapshot->'settings', array[
            'id', 'footer_terms_visible', 'footer_terms_pdf_url', 'footer_privacy_visible',
            'footer_privacy_pdf_url', 'footer_cookie_visible', 'footer_cookie_pdf_url',
            'site_name', 'company_name', 'home_copy', 'golden_visa_copy', 'contact_copy',
            'stages_copy', 'footer_phone', 'footer_email', 'footer_address',
            'facebook_visible', 'facebook_url', 'instagram_visible', 'instagram_url',
            'linkedin_visible', 'linkedin_url', 'whatsapp_visible', 'whatsapp_phone',
            'whatsapp_message', 'logo_url', 'brand_color', 'updated_at'
          ])
          or miracon.has_exact_jsonb_keys(p_snapshot->'settings', array[
            'id', 'footer_terms_visible', 'footer_terms_pdf_url', 'footer_privacy_visible',
            'footer_privacy_pdf_url', 'footer_cookie_visible', 'footer_cookie_pdf_url',
            'footer_terms_el_visible', 'footer_terms_el_pdf_url',
            'footer_privacy_el_visible', 'footer_privacy_el_pdf_url',
            'footer_cookie_el_visible', 'footer_cookie_el_pdf_url',
            'site_name', 'company_name', 'home_copy', 'golden_visa_copy', 'contact_copy',
            'stages_copy', 'footer_phone', 'footer_email', 'footer_address',
            'facebook_visible', 'facebook_url', 'instagram_visible', 'instagram_url',
            'linkedin_visible', 'linkedin_url', 'whatsapp_visible', 'whatsapp_phone',
            'whatsapp_message', 'logo_url', 'brand_color', 'updated_at'
          ])
        )
        and (not (p_snapshot->'settings' ? 'logo_url') or (
          jsonb_typeof(p_snapshot->'settings'->'logo_url') = 'string'
          and (p_snapshot->'settings'->>'logo_url' = ''
            or p_snapshot->'settings'->>'logo_url' ~ '^/media/uploads/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/\1\.(svg|png)$')
        ))
        and (not (p_snapshot->'settings' ? 'brand_color') or (
          jsonb_typeof(p_snapshot->'settings'->'brand_color') = 'string'
          and p_snapshot->'settings'->>'brand_color' ~ '^#[0-9a-fA-F]{6}$'
        ))
        and (not (p_snapshot->'settings' ? 'footer_terms_el_visible') or (
          jsonb_typeof(p_snapshot->'settings'->'footer_terms_el_visible') = 'boolean'
          and jsonb_typeof(p_snapshot->'settings'->'footer_privacy_el_visible') = 'boolean'
          and jsonb_typeof(p_snapshot->'settings'->'footer_cookie_el_visible') = 'boolean'
          and (p_snapshot->'settings'->>'footer_terms_el_visible' = 'false'
            or p_snapshot->'settings'->>'footer_terms_el_pdf_url' <> '')
          and (p_snapshot->'settings'->>'footer_privacy_el_visible' = 'false'
            or p_snapshot->'settings'->>'footer_privacy_el_pdf_url' <> '')
          and (p_snapshot->'settings'->>'footer_cookie_el_visible' = 'false'
            or p_snapshot->'settings'->>'footer_cookie_el_pdf_url' <> '')
          and jsonb_typeof(p_snapshot->'settings'->'footer_terms_el_pdf_url') = 'string'
          and jsonb_typeof(p_snapshot->'settings'->'footer_privacy_el_pdf_url') = 'string'
          and jsonb_typeof(p_snapshot->'settings'->'footer_cookie_el_pdf_url') = 'string'
          and length(p_snapshot->'settings'->>'footer_terms_el_pdf_url') <= 2048
          and length(p_snapshot->'settings'->>'footer_privacy_el_pdf_url') <= 2048
          and length(p_snapshot->'settings'->>'footer_cookie_el_pdf_url') <= 2048
          and (p_snapshot->'settings'->>'footer_terms_el_pdf_url' = ''
            or p_snapshot->'settings'->>'footer_terms_el_pdf_url' ~* '^(https://|/media/)')
          and (p_snapshot->'settings'->>'footer_privacy_el_pdf_url' = ''
            or p_snapshot->'settings'->>'footer_privacy_el_pdf_url' ~* '^(https://|/media/)')
          and (p_snapshot->'settings'->>'footer_cookie_el_pdf_url' = ''
            or p_snapshot->'settings'->>'footer_cookie_el_pdf_url' ~* '^(https://|/media/)')
        ))
        and jsonb_typeof(p_snapshot->'settings'->'id') = 'number'
        and p_snapshot->'settings'->'id' is not distinct from '1'::jsonb
      else false
    end,
    false
  );
$$;

-- Exact materialization must reset localized fields for historical rollbacks.
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
            footer_terms_el_visible = coalesce(exact.footer_terms_el_visible, false),
            footer_terms_el_pdf_url = coalesce(exact.footer_terms_el_pdf_url, ''),
            footer_privacy_el_visible = coalesce(exact.footer_privacy_el_visible, false),
            footer_privacy_el_pdf_url = coalesce(exact.footer_privacy_el_pdf_url, ''),
            footer_cookie_el_visible = coalesce(exact.footer_cookie_el_visible, false),
            footer_cookie_el_pdf_url = coalesce(exact.footer_cookie_el_pdf_url, ''),
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
            logo_url = coalesce(exact.logo_url, ''),
            brand_color = coalesce(exact.brand_color, '#003075'),
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

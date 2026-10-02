-- Uploaded media uses the full 8-4-4-4-12 UUID in both URL segments.
-- 0015 omitted the fourth group in the PostgreSQL regex, so valid logo
-- uploads passed the application validator but could not be published.
alter table miracon.site_settings
  drop constraint site_settings_logo_url_format;
alter table miracon.site_settings
  add constraint site_settings_logo_url_format check (
    logo_url = '' or logo_url ~ '^/media/uploads/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/\1\.(svg|png)$'
  );

-- Keep the complete-snapshot shape and historical rollback behavior of 0015.
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
        and jsonb_typeof(p_snapshot->'settings'->'id') = 'number'
        and p_snapshot->'settings'->'id' is not distinct from '1'::jsonb
      else false
    end,
    false
  );
$$;

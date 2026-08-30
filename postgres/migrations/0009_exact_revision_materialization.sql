create or replace function miracon.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if nullif(current_setting('miracon.exact_revision_materialization', true), '') is null then
    new.updated_at = now();
  end if;
  return new;
end;
$$;

create or replace function miracon.set_project_timestamps()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if nullif(current_setting('miracon.exact_revision_materialization', true), '') is null then
    new.updated_at = now();
    if new.status = 'published'
      and (tg_op = 'INSERT' or old.status is distinct from 'published') then
      new.published_at = now();
    end if;
  end if;
  return new;
end;
$$;

create function miracon.materialize_content_revision(p_revision_id uuid) returns jsonb
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
  select *
  into v_revision
  from miracon.content_revisions
  where id = p_revision_id
    and state = 'approved'
  for update;

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
          if exists (
            select 1 from miracon.homepage_videos where project_id = v_revision.aggregate_id
          ) then
            raise exception 'Homepage references project' using errcode = '23503';
          end if;
          delete from miracon.projects where id = v_revision.aggregate_id;
          v_materialized := jsonb_build_object(
            'aggregateType', 'project',
            'aggregateId', v_revision.aggregate_id,
            'deleted', true,
            'project', null,
            'images', jsonb_build_array()
          );
        else
          insert into miracon.projects
          select (jsonb_populate_record(null::miracon.projects, v_snapshot->'project')).*
          on conflict (id) do update set
            slug = excluded.slug,
            title = excluded.title,
            address = excluded.address,
            card_address = excluded.card_address,
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
            image_variants = excluded.image_variants,
            hero_type = excluded.hero_type,
            hero_variant = excluded.hero_variant,
            hero_sound_enabled = excluded.hero_sound_enabled,
            hero_idle_ui = excluded.hero_idle_ui,
            hero_url = excluded.hero_url,
            hero_mobile_url = excluded.hero_mobile_url,
            hero_poster_url = excluded.hero_poster_url,
            hero_videos = excluded.hero_videos,
            walkthrough_video_enabled = excluded.walkthrough_video_enabled,
            walkthrough_video_title = excluded.walkthrough_video_title,
            walkthrough_video_desktop_url = excluded.walkthrough_video_desktop_url,
            walkthrough_video_mobile_url = excluded.walkthrough_video_mobile_url,
            walkthrough_video_poster_url = excluded.walkthrough_video_poster_url,
            walkthrough_videos = excluded.walkthrough_videos,
            hero_focal_x = excluded.hero_focal_x,
            hero_focal_y = excluded.hero_focal_y,
            intro_image_url = excluded.intro_image_url,
            brochure_url = excluded.brochure_url,
            map_query = excluded.map_query,
            map_url = excluded.map_url,
            characteristics = excluded.characteristics,
            benefits = excluded.benefits,
            floor_plan_groups = excluded.floor_plan_groups,
            nearby_places = excluded.nearby_places,
            translations = excluded.translations,
            seo_title = excluded.seo_title,
            seo_description = excluded.seo_description,
            published_at = excluded.published_at,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            remaining_units = excluded.remaining_units;

          delete from miracon.project_images where project_id = v_revision.aggregate_id;
          insert into miracon.project_images
          select * from jsonb_populate_recordset(null::miracon.project_images, v_snapshot->'images');

          select jsonb_build_object(
            'aggregateType', 'project',
            'aggregateId', v_revision.aggregate_id,
            'deleted', false,
            'project', to_jsonb(project),
            'images', coalesce((
              select jsonb_agg(to_jsonb(image) order by image.role, image.sort_order, image.id)
              from miracon.project_images as image
              where image.project_id = project.id
            ), '[]'::jsonb)
          )
          into v_materialized
          from miracon.projects as project
          where project.id = v_revision.aggregate_id;
        end if;
      when 'homepage_hero' then
        perform pg_advisory_xact_lock(hashtextextended('miracon.replace_homepage_videos', 0));
        delete from miracon.homepage_videos;
        insert into miracon.homepage_videos
        select * from jsonb_populate_recordset(null::miracon.homepage_videos, v_snapshot->'videos');

        select jsonb_build_object(
          'aggregateType', 'homepage_hero',
          'aggregateId', 'singleton',
          'videos', coalesce(
            jsonb_agg(to_jsonb(video) order by video.sort_order, video.id)
              filter (where video.id is not null),
            '[]'::jsonb
          )
        )
        into v_materialized
        from (select 1) as singleton
        left join miracon.homepage_videos as video on true;
      when 'site_settings' then
        update miracon.site_settings as settings
        set footer_terms_visible = exact.footer_terms_visible,
            footer_terms_pdf_url = exact.footer_terms_pdf_url,
            footer_privacy_visible = exact.footer_privacy_visible,
            footer_privacy_pdf_url = exact.footer_privacy_pdf_url,
            footer_cookie_visible = exact.footer_cookie_visible,
            footer_cookie_pdf_url = exact.footer_cookie_pdf_url,
            updated_at = exact.updated_at
        from jsonb_populate_record(null::miracon.site_settings, v_snapshot->'settings') as exact
        where settings.id = 1;

        select jsonb_build_object(
          'aggregateType', 'site_settings',
          'aggregateId', 'singleton',
          'settings', to_jsonb(settings)
        )
        into v_materialized
        from miracon.site_settings as settings
        where settings.id = 1;
    end case;
  exception when others then
    perform set_config('miracon.exact_revision_materialization', coalesce(v_previous_context, ''), true);
    raise;
  end;

  perform set_config('miracon.exact_revision_materialization', coalesce(v_previous_context, ''), true);
  return v_materialized;
end;
$$;

revoke all on function miracon.materialize_content_revision(uuid) from public;

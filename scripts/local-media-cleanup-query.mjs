const REFERENCE_CTES = `
  with project_scalar_references(reference) as (
    select reference
    from miracon.projects as project
    cross join lateral (values
      (project.cover_url),
      (project.hero_url),
      (project.hero_mobile_url),
      (project.hero_poster_url),
      (project.walkthrough_video_desktop_url),
      (project.walkthrough_video_mobile_url),
      (project.walkthrough_video_poster_url),
      (project.intro_image_url),
      (project.brochure_url)
    ) as media_reference(reference)
  ),
  project_json_references(reference) as (
    select source_url
    from miracon.projects as project
    cross join lateral jsonb_object_keys(coalesce(project.image_variants->'images', '{}'::jsonb)) as source(source_url)
    union all
    select value #>> '{}'
    from miracon.projects as project
    cross join lateral jsonb_path_query(project.image_variants, '$.images.*.*[*].src') as media_reference(value)
    union all
    select value #>> '{}'
    from miracon.projects as project
    cross join lateral jsonb_path_query(project.hero_videos, '$[*].*') as media_reference(value)
    where jsonb_typeof(value) = 'string'
    union all
    select value #>> '{}'
    from miracon.projects as project
    cross join lateral jsonb_path_query(project.walkthrough_videos, '$[*].*') as media_reference(value)
    where jsonb_typeof(value) = 'string'
    union all
    select value #>> '{}'
    from miracon.projects as project
    cross join lateral jsonb_path_query(project.benefits, '$[*].icon') as media_reference(value)
    union all
    select value #>> '{}'
    from miracon.projects as project
    cross join lateral jsonb_path_query(project.floor_plan_groups, '$[*].plans[*].imageUrl') as media_reference(value)
  ),
  raw_media_references(reference) as (
    select reference from project_scalar_references
    union all select reference from project_json_references
    union all select url from miracon.project_images
    union all select storage_path from miracon.project_images
    union all select desktop_url from miracon.homepage_videos
    union all select desktop_storage_path from miracon.homepage_videos
    union all select mobile_url from miracon.homepage_videos
    union all select mobile_storage_path from miracon.homepage_videos
    union all select footer_terms_pdf_url from miracon.site_settings
    union all select footer_privacy_pdf_url from miracon.site_settings
    union all select footer_cookie_pdf_url from miracon.site_settings
  ),
  media_references(reference) as (
    select regexp_replace(reference, '[?#].*$', '')
    from raw_media_references
    where reference is not null
  )
`;

const CANDIDATE_COLUMNS = `
  media.id,
  media.relative_url,
  media.relative_path,
  media.created_at,
  media.deletion_pending_at
`;

const IS_REFERENCED = `
  (
    exists (
      select 1
      from media_references
      where reference = media.relative_url
        or reference = media.relative_path
        or reference = $2::text || media.relative_url
    )
    or exists (
      select 1
      from miracon.revision_media as revision_media
      where revision_media.media_file_id = media.id
    )
  )
`;

const IS_ORPHAN = `
  media.created_at <= $1
  and not ${IS_REFERENCED}
`;

export const DISCOVER_LOCAL_MEDIA_ORPHANS_SQL = `${REFERENCE_CTES}
  select ${CANDIDATE_COLUMNS}
  from miracon.media_files as media
  where media.deletion_pending_at is not null or (${IS_ORPHAN})
  order by media.deletion_pending_at nulls last, media.created_at, media.id
  limit $3
`;

export const MARK_LOCAL_MEDIA_PENDING_SQL = `${REFERENCE_CTES},
  requested_media as (
    select id, relative_path
    from jsonb_to_recordset($3::jsonb) as requested(id text, relative_path text)
  )
  update miracon.media_files as media
  set deletion_pending_at = coalesce(media.deletion_pending_at, clock_timestamp())
  from requested_media as requested
  where requested.id = media.id
    and requested.relative_path = media.relative_path
    and (media.deletion_pending_at is not null or (${IS_ORPHAN}))
  returning ${CANDIDATE_COLUMNS}
`;

export const LOCK_PENDING_LOCAL_MEDIA_SQL = `${REFERENCE_CTES},
  requested_media as (
    select id, relative_path
    from jsonb_to_recordset($3::jsonb) as requested(id text, relative_path text)
  )
  select ${CANDIDATE_COLUMNS}, not ${IS_REFERENCED} as is_orphan
  from miracon.media_files as media
  join requested_media as requested
    on requested.id = media.id and requested.relative_path = media.relative_path
  where media.deletion_pending_at is not null
  for update of media
`;

export const CLEAR_LOCAL_MEDIA_PENDING_SQL = `
  update miracon.media_files
  set deletion_pending_at = null
  where id = $1 and relative_path = $2 and deletion_pending_at is not null
`;

export const FINALIZE_LOCAL_MEDIA_METADATA_SQL = `
  delete from miracon.media_files
  where id = $1 and relative_path = $2 and deletion_pending_at is not null
`;

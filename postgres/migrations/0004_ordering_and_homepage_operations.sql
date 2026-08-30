create function miracon.reorder_projects(p_items jsonb)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Project order must be a JSON array' using errcode = '22023';
  end if;

  update miracon.projects as project
  set sort_order = item.sort_order
  from jsonb_to_recordset(p_items) as item(id text, sort_order integer)
  where project.id = item.id;
end;
$$;

create function miracon.delete_project(p_project_id text)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if p_project_id is null or btrim(p_project_id) = '' then
    raise exception 'Project id is required' using errcode = '22023';
  end if;
  delete from miracon.projects where id = p_project_id;
end;
$$;

create function miracon.replace_homepage_videos(p_items jsonb)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Homepage videos must be a JSON array' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('miracon.replace_homepage_videos', 0));

  delete from miracon.homepage_videos;
  insert into miracon.homepage_videos
    (id, title, project_id, desktop_url, desktop_storage_path, mobile_url,
      mobile_storage_path, sort_order, is_active)
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
  from jsonb_to_recordset(p_items) as item(
    id text, title text, project_id text, desktop_url text, desktop_storage_path text,
    mobile_url text, mobile_storage_path text, sort_order integer, is_active boolean
  );
end;
$$;

revoke execute on function miracon.reorder_projects(jsonb) from public;
revoke execute on function miracon.delete_project(text) from public;
revoke execute on function miracon.replace_homepage_videos(jsonb) from public;
revoke all on schema miracon from public;

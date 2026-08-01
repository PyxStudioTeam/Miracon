alter table public.projects
  add column translations jsonb not null default '{}'::jsonb;

alter table public.projects
  add constraint projects_translations_object
  check (jsonb_typeof(translations) = 'object');

-- Preserve the latest media-aware save implementation and wrap it so project
-- content and its locale overlay are committed in the same transaction.
alter function public.save_project_with_images(jsonb, jsonb)
  rename to save_project_with_images_core;

revoke execute on function public.save_project_with_images_core(jsonb, jsonb)
  from public, anon, authenticated;

create function public.save_project_with_images(
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
  v_has_translations boolean := p_project ? 'translations';
  v_translations jsonb := p_project->'translations';
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if v_has_translations and jsonb_typeof(v_translations) is distinct from 'object' then
    raise exception 'Project translations must be a JSON object' using errcode = '22023';
  end if;

  perform public.save_project_with_images_core(p_project, p_images);

  if v_has_translations then
    update public.projects
    set translations = translations || v_translations
    where id = v_project_id;
  end if;
end;
$$;

revoke execute on function public.save_project_with_images(jsonb, jsonb) from public, anon;
grant execute on function public.save_project_with_images(jsonb, jsonb) to authenticated;

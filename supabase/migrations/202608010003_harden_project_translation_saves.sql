-- Forward-only hardening for databases where the translations migration ran
-- before omitted and partial translation payloads were made non-destructive.
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

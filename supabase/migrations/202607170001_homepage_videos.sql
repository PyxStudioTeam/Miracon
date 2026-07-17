create table public.homepage_videos (
  id text primary key default gen_random_uuid()::text,
  title text not null default '',
  project_id text references public.projects(id) on delete set null,
  desktop_url text not null default '',
  desktop_storage_path text,
  mobile_url text,
  mobile_storage_path text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index homepage_videos_active_sort_idx
on public.homepage_videos(is_active, sort_order);

create or replace function public.set_homepage_video_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger homepage_videos_set_updated_at
before insert or update on public.homepage_videos
for each row execute function public.set_homepage_video_updated_at();

alter table public.homepage_videos enable row level security;

create policy "Active homepage videos are public"
on public.homepage_videos for select
using ((is_active and desktop_url <> '') or public.is_admin());

create policy "Admins can insert homepage videos"
on public.homepage_videos for insert
with check (public.is_admin());

create policy "Admins can update homepage videos"
on public.homepage_videos for update
using (public.is_admin())
with check (public.is_admin());

create policy "Admins can delete homepage videos"
on public.homepage_videos for delete
using (public.is_admin());

insert into public.homepage_videos (
  id,
  title,
  desktop_url,
  mobile_url,
  sort_order,
  is_active
)
values (
  'default-home-hero',
  'MIRACON introduction',
  '/img/hero-bg-optimized.mp4',
  '/img/hero-bg-mobile.mp4',
  0,
  true
)
on conflict (id) do nothing;

create or replace function public.replace_homepage_videos(p_items jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  delete from public.homepage_videos;

  insert into public.homepage_videos (
    id,
    title,
    project_id,
    desktop_url,
    desktop_storage_path,
    mobile_url,
    mobile_storage_path,
    sort_order,
    is_active
  )
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
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as item(
    id text,
    title text,
    project_id text,
    desktop_url text,
    desktop_storage_path text,
    mobile_url text,
    mobile_storage_path text,
    sort_order integer,
    is_active boolean
  );
end;
$$;

revoke execute on function public.replace_homepage_videos(jsonb) from public, anon;
grant execute on function public.replace_homepage_videos(jsonb) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 52428800, array['video/mp4'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Site media is publicly readable"
on storage.objects for select
using (bucket_id = 'site-media');

create policy "Admins can upload site media"
on storage.objects for insert
with check (bucket_id = 'site-media' and public.is_admin());

create policy "Admins can update site media"
on storage.objects for update
using (bucket_id = 'site-media' and public.is_admin())
with check (bucket_id = 'site-media' and public.is_admin());

create policy "Admins can delete site media"
on storage.objects for delete
using (bucket_id = 'site-media' and public.is_admin());

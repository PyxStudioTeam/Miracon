create extension if not exists pgcrypto;

create type public.project_status as enum ('draft', 'published');
create type public.project_image_role as enum ('card', 'gallery');

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.projects (
  id text primary key default gen_random_uuid()::text,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text not null,
  address text not null default '',
  price text not null default '',
  short_description text not null default '',
  full_description text not null default '',
  intro_title text not null default '',
  categories text[] not null default '{}' check (categories <@ array['coastal', 'city', 'golden-visa']::text[]),
  status public.project_status not null default 'draft',
  sort_order integer not null default 0,
  cover_url text not null default '',
  hero_type text not null default 'image' check (hero_type in ('image', 'video')),
  hero_url text not null default '',
  hero_poster_url text,
  intro_image_url text not null default '',
  brochure_url text,
  map_query text not null default '',
  characteristics jsonb not null default '[]'::jsonb,
  benefits jsonb not null default '[]'::jsonb,
  floor_plan_groups jsonb not null default '[]'::jsonb,
  nearby_places jsonb not null default '[]'::jsonb,
  seo_title text not null default '',
  seo_description text not null default '',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_images (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references public.projects(id) on delete cascade,
  url text not null,
  storage_path text,
  alt text not null default '',
  role public.project_image_role not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index projects_status_sort_idx on public.projects(status, sort_order);
create index project_images_project_sort_idx on public.project_images(project_id, role, sort_order);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users where user_id = auth.uid()
  );
$$;

create or replace function public.set_project_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    new.published_at = now();
  end if;
  return new;
end;
$$;

create trigger projects_set_updated_at
before insert or update on public.projects
for each row execute function public.set_project_updated_at();

alter table public.admin_users enable row level security;
alter table public.projects enable row level security;
alter table public.project_images enable row level security;

create policy "Admins can view their membership"
on public.admin_users for select
using (user_id = auth.uid());

create policy "Published projects are public"
on public.projects for select
using (status = 'published' or public.is_admin());

create policy "Admins can insert projects"
on public.projects for insert
with check (public.is_admin());

create policy "Admins can update projects"
on public.projects for update
using (public.is_admin())
with check (public.is_admin());

create policy "Admins can delete projects"
on public.projects for delete
using (public.is_admin());

create policy "Published project images are public"
on public.project_images for select
using (
  public.is_admin() or exists (
    select 1 from public.projects
    where projects.id = project_images.project_id
      and projects.status = 'published'
  )
);

create policy "Admins can insert project images"
on public.project_images for insert
with check (public.is_admin());

create policy "Admins can update project images"
on public.project_images for update
using (public.is_admin())
with check (public.is_admin());

create policy "Admins can delete project images"
on public.project_images for delete
using (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('project-media', 'project-media', true, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'video/mp4']),
  ('project-documents', 'project-documents', true, 26214400, array['application/pdf'])
on conflict (id) do nothing;

create policy "Project assets are publicly readable"
on storage.objects for select
using (bucket_id in ('project-media', 'project-documents'));

create policy "Admins can upload project assets"
on storage.objects for insert
with check (bucket_id in ('project-media', 'project-documents') and public.is_admin());

create policy "Admins can update project assets"
on storage.objects for update
using (bucket_id in ('project-media', 'project-documents') and public.is_admin())
with check (bucket_id in ('project-media', 'project-documents') and public.is_admin());

create policy "Admins can delete project assets"
on storage.objects for delete
using (bucket_id in ('project-media', 'project-documents') and public.is_admin());

-- After creating the administrator in Authentication > Users, run once:
-- insert into public.admin_users (user_id) values ('AUTH_USER_UUID');

create schema if not exists miracon;

create type miracon.project_status as enum ('draft', 'published');
create type miracon.project_image_role as enum ('card', 'gallery');

create function miracon.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create function miracon.set_project_timestamps()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  if new.status = 'published'
    and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    new.published_at = now();
  end if;
  return new;
end;
$$;

create table miracon.projects (
  id text primary key check (btrim(id) <> ''),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text not null check (btrim(title) <> ''),
  address text not null default '',
  card_address text not null default '',
  price text not null default '',
  short_description text not null default '',
  full_description text not null default '',
  intro_title text not null default '',
  categories text[] not null default '{}'
    check (categories <@ array['coastal', 'city', 'golden-visa']::text[]),
  status miracon.project_status not null default 'draft',
  sort_order integer not null default 0 check (sort_order >= 0),
  cover_url text not null default '',
  cover_focal_x numeric(5, 2) not null default 50 check (cover_focal_x between 0 and 100),
  cover_focal_y numeric(5, 2) not null default 50 check (cover_focal_y between 0 and 100),
  image_variants jsonb not null default '{"version":1,"images":{}}'::jsonb
    check (jsonb_typeof(image_variants) = 'object'),
  hero_type text not null default 'image' check (hero_type in ('image', 'video')),
  hero_variant text not null default 'standard' check (hero_variant in ('standard', 'immersive')),
  hero_sound_enabled boolean not null default false,
  hero_idle_ui boolean not null default false,
  hero_url text not null default '',
  hero_mobile_url text,
  hero_poster_url text,
  hero_videos jsonb not null default '[]'::jsonb check (jsonb_typeof(hero_videos) = 'array'),
  walkthrough_video_enabled boolean not null default false,
  walkthrough_video_title text not null default 'Virtual walkthrough',
  walkthrough_video_desktop_url text not null default '',
  walkthrough_video_mobile_url text,
  walkthrough_video_poster_url text,
  walkthrough_videos jsonb not null default '[]'::jsonb
    check (jsonb_typeof(walkthrough_videos) = 'array'),
  hero_focal_x numeric(5, 2) not null default 50 check (hero_focal_x between 0 and 100),
  hero_focal_y numeric(5, 2) not null default 50 check (hero_focal_y between 0 and 100),
  intro_image_url text not null default '',
  brochure_url text,
  map_query text not null default '',
  map_url text not null default '',
  characteristics jsonb not null default '[]'::jsonb
    check (jsonb_typeof(characteristics) = 'array'),
  benefits jsonb not null default '[]'::jsonb check (jsonb_typeof(benefits) = 'array'),
  floor_plan_groups jsonb not null default '[]'::jsonb
    check (jsonb_typeof(floor_plan_groups) = 'array'),
  nearby_places jsonb not null default '[]'::jsonb
    check (jsonb_typeof(nearby_places) = 'array'),
  translations jsonb not null default '{}'::jsonb check (jsonb_typeof(translations) = 'object'),
  seo_title text not null default '',
  seo_description text not null default '',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table miracon.project_images (
  id text primary key check (btrim(id) <> ''),
  project_id text not null references miracon.projects(id) on delete cascade,
  url text not null check (btrim(url) <> ''),
  storage_path text,
  alt text not null default '',
  role miracon.project_image_role not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  focal_x numeric(5, 2) not null default 50 check (focal_x between 0 and 100),
  focal_y numeric(5, 2) not null default 50 check (focal_y between 0 and 100),
  created_at timestamptz not null default now()
);

create table miracon.homepage_videos (
  id text primary key check (btrim(id) <> ''),
  title text not null default '',
  project_id text references miracon.projects(id) on delete set null,
  desktop_url text not null default '',
  desktop_storage_path text,
  mobile_url text,
  mobile_storage_path text,
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not is_active or btrim(desktop_url) <> '')
);

create table miracon.site_settings (
  id smallint primary key default 1 check (id = 1),
  footer_terms_visible boolean not null default false,
  footer_terms_pdf_url text not null default '',
  footer_privacy_visible boolean not null default false,
  footer_privacy_pdf_url text not null default '',
  footer_cookie_visible boolean not null default false,
  footer_cookie_pdf_url text not null default '',
  updated_at timestamptz not null default now(),
  check (footer_terms_pdf_url = '' or footer_terms_pdf_url ~* '^(https://|/media/)'),
  check (footer_privacy_pdf_url = '' or footer_privacy_pdf_url ~* '^(https://|/media/)'),
  check (footer_cookie_pdf_url = '' or footer_cookie_pdf_url ~* '^(https://|/media/)'),
  check (not footer_terms_visible or footer_terms_pdf_url <> ''),
  check (not footer_privacy_visible or footer_privacy_pdf_url <> ''),
  check (not footer_cookie_visible or footer_cookie_pdf_url <> '')
);

create index projects_status_sort_idx on miracon.projects(status, sort_order);
create index project_images_project_sort_idx on miracon.project_images(project_id, role, sort_order);
create index homepage_videos_active_sort_idx on miracon.homepage_videos(is_active, sort_order);

create trigger projects_set_timestamps
before insert or update on miracon.projects
for each row execute function miracon.set_project_timestamps();

create trigger homepage_videos_set_updated_at
before update on miracon.homepage_videos
for each row execute function miracon.set_updated_at();

create trigger site_settings_set_updated_at
before update on miracon.site_settings
for each row execute function miracon.set_updated_at();

insert into miracon.site_settings (id) values (1);

insert into miracon.homepage_videos
  (id, title, desktop_url, mobile_url, sort_order, is_active)
values
  ('default-home-hero', 'MIRACON introduction', '/img/hero-bg-web-30.mp4', '/img/hero-bg-mobile.mp4', 0, true),
  ('home-hero-02', 'MIRACON showcase', '/img/home-hero-02-web-720.mp4', null, 1, true);

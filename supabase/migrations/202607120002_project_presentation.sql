alter table public.projects
  add column if not exists hero_variant text not null default 'standard',
  add column if not exists hero_sound_enabled boolean not null default false,
  add column if not exists hero_idle_ui boolean not null default false,
  add column if not exists hero_focal_x numeric(5, 2) not null default 50,
  add column if not exists hero_focal_y numeric(5, 2) not null default 50,
  add column if not exists cover_focal_x numeric(5, 2) not null default 50,
  add column if not exists cover_focal_y numeric(5, 2) not null default 50;

alter table public.projects
  drop constraint if exists projects_hero_variant_check,
  drop constraint if exists projects_hero_focal_x_check,
  drop constraint if exists projects_hero_focal_y_check,
  drop constraint if exists projects_cover_focal_x_check,
  drop constraint if exists projects_cover_focal_y_check;

alter table public.projects
  add constraint projects_hero_variant_check check (hero_variant in ('standard', 'immersive')),
  add constraint projects_hero_focal_x_check check (hero_focal_x between 0 and 100),
  add constraint projects_hero_focal_y_check check (hero_focal_y between 0 and 100),
  add constraint projects_cover_focal_x_check check (cover_focal_x between 0 and 100),
  add constraint projects_cover_focal_y_check check (cover_focal_y between 0 and 100);

alter table public.project_images
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists focal_x numeric(5, 2) not null default 50,
  add column if not exists focal_y numeric(5, 2) not null default 50;

alter table public.project_images
  drop constraint if exists project_images_width_check,
  drop constraint if exists project_images_height_check,
  drop constraint if exists project_images_focal_x_check,
  drop constraint if exists project_images_focal_y_check;

alter table public.project_images
  add constraint project_images_width_check check (width is null or width > 0),
  add constraint project_images_height_check check (height is null or height > 0),
  add constraint project_images_focal_x_check check (focal_x between 0 and 100),
  add constraint project_images_focal_y_check check (focal_y between 0 and 100);

update public.projects
set
  hero_variant = 'immersive',
  hero_sound_enabled = true,
  hero_idle_ui = true
where slug = 'kriopigi-villas';

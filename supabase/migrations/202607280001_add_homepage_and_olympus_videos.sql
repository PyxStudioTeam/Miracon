with ranked_homepage_videos as (
  select
    id,
    row_number() over (order by sort_order, created_at, id) as position
  from public.homepage_videos
  where is_active
    and id <> 'home-hero-02'
)
update public.homepage_videos as video
set sort_order = case
  when ranked.position = 1 then 0
  else ranked.position
end
from ranked_homepage_videos as ranked
where video.id = ranked.id;

update public.homepage_videos
set desktop_url = '/img/hero-bg-web-30.mp4'
where id = 'default-home-hero';

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
values (
  'home-hero-02',
  'MIRACON showcase',
  null,
  '/img/home-hero-02-web-720.mp4',
  null,
  null,
  null,
  1,
  true
)
on conflict (id) do update set
  title = excluded.title,
  project_id = excluded.project_id,
  desktop_url = excluded.desktop_url,
  desktop_storage_path = excluded.desktop_storage_path,
  mobile_url = excluded.mobile_url,
  mobile_storage_path = excluded.mobile_storage_path,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

update public.projects
set
  hero_type = 'video',
  hero_variant = 'immersive',
  hero_sound_enabled = true,
  hero_idle_ui = true,
  hero_url = '/img/olympus-detail/hero-video-web.mp4',
  hero_mobile_url = null,
  hero_poster_url = '/img/olympus-detail/hero.png',
  hero_videos = jsonb_build_array(jsonb_build_object(
    'id', 'olympus-sea-view-hero-1',
    'desktopUrl', '/img/olympus-detail/hero-video-web.mp4',
    'mobileUrl', null,
    'posterUrl', '/img/olympus-detail/hero.png'
  ))
where slug = 'olympus-sea-view';

update public.projects
set
  hero_variant = 'immersive',
  hero_idle_ui = true
where hero_type = 'video';

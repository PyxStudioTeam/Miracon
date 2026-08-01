update public.homepage_videos
set mobile_url = '/img/hero-bg-mobile.mp4'
where id = 'default-home-hero'
  and (mobile_url is null or mobile_url = '');

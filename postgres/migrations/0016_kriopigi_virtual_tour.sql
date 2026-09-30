-- Populate the supplied tour for existing catalogs without replacing an editor's URL.
update miracon.projects
set virtual_tour_url = 'https://storage.net-fs.com/hosting/8422073/52/'
where id = 'kriopigi-villas'
  and slug = 'kriopigi-villas'
  and virtual_tour_url = '';

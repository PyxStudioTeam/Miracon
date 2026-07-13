update public.projects
set benefits = $benefits$
[
  {"id":"central-location","title":"Central Thessaloniki location","icon":"/img/giannitson-detail/icons/amenity-central-location.svg"},
  {"id":"nine-storeys","title":"9-storey residential landmark","icon":"/img/giannitson-detail/icons/amenity-nine-storeys.svg"},
  {"id":"apartments","title":"32 modern apartments","icon":"/img/giannitson-detail/icons/amenity-apartments.svg"},
  {"id":"penthouses","title":"Exclusive duplex penthouses","icon":"/img/giannitson-detail/icons/amenity-penthouses.svg"},
  {"id":"natural-light","title":"Abundant natural light","icon":"/img/giannitson-detail/icons/amenity-natural-light.svg"},
  {"id":"architecture","title":"Contemporary architecture","icon":"/img/giannitson-detail/icons/amenity-architecture.svg"},
  {"id":"finishes","title":"Premium quality finishes","icon":"/img/giannitson-detail/icons/amenity-finishes.svg"},
  {"id":"connections","title":"Excellent transport connections","icon":"/img/giannitson-detail/icons/amenity-connections.svg"}
]
$benefits$::jsonb
where slug = 'giannitson-thessaloniki';

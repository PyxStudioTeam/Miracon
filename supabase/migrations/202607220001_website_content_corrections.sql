alter table public.projects
  add column if not exists card_address text not null default '',
  add column if not exists map_url text not null default '';

update public.projects
set
  address = 'Kriopigi Beach, Halkidiki',
  card_address = 'Where Luxury Meets the Aegean',
  short_description = 'Welcome to an exclusive collection of just four private villas, perfectly positioned on the prestigious first coastline of Halkidiki. Enjoy breathtaking panoramic sea views from an elevated cliffside setting, expansive private plots exceeding 1,000 m², elegant contemporary interiors, and your own private swimming pool. Only steps away from a hidden, unspoiled beach, these residences offer the perfect balance of privacy, natural beauty, and refined coastal living. Wake up to the endless blue of the Aegean. Come home to a life beyond expectations',
  full_description = E'Welcome to Kriopigi Villas — a strictly limited collection of just four standalone beachfront villas by MIRACON Constructions\n\nNestled in a secluded enclave on the pristine Kassandra coastline, each villa offers sweeping panoramic views of the Aegean Sea, absolute privacy, and a private swimming pool — just a short stroll from an untouched private beach',
  map_query = '40.043045,23.478448',
  map_url = 'https://maps.app.goo.gl/oNShmLUfoEc3PRE66',
  characteristics = '[{"id":"bedrooms","label":"Bedrooms","value":"2-3","icon":"bed"},{"id":"bathrooms","label":"Bathrooms","value":"1-2","icon":"bath"},{"id":"area","label":"Area","value":"110-175 m²","icon":"area"},{"id":"levels","label":"Levels","value":"2-3","icon":"levels"}]'::jsonb,
  floor_plan_groups = (
    select coalesce(jsonb_agg(
      case when item->>'id' = 'three-level'
        then jsonb_set(item, '{title}', '"Three-level 175m² villa"'::jsonb)
        else item
      end
      order by ordinal
    ), '[]'::jsonb)
    from jsonb_array_elements(floor_plan_groups) with ordinality as groups(item, ordinal)
  )
where slug = 'kriopigi-villas';

update public.projects
set
  address = 'Perea, Thessaloniki',
  card_address = 'Perea sea beach location',
  short_description = 'A premier beachfront complex on the first shoreline of Perea. Five brand new buildings, 30 modern units: apartments, studios and two-level duplexes with panoramic sea views from the private balcony. 30 minutes from Thessaloniki city center. 20 minutes from Thessaloniki Airport. Few steps from the Aegean Sea',
  full_description = E'Welcome to Olympus Sea View — a premier beachfront residential complex on the first shoreline of Perea\n\nDesigned for those who seek the perfect balance of coastal serenity and modern comfort, it offers exclusivity, premium finishes, and breathtaking sea views. All buildings are equipped with elevators',
  map_query = '40.505561,22.912159',
  map_url = 'https://maps.app.goo.gl/sx5WvRo1t9G2nkRYA',
  seo_description = 'Beachfront apartments in Perea with panoramic sea views and premium finishes.'
where slug = 'olympus-sea-view';

update public.projects
set
  address = 'Nea Kallikratia, Halkidiki',
  card_address = 'Nea Kallikratia, Halkidiki',
  short_description = 'Ready-to-move premium apartments in popular Nea Kallikratia resort town, 400m from the sea beach. Last 2 duplexes are available. Complete with dedicated parking and private storage',
  full_description = E'A premium boutique residence by MIRACON Constructions, located in the heart of Nea Kallikratia — one of the most popular seaside destinations, an hour drive from Thessaloniki. A building is equipped with elevator\n\nJust 400 meters from Nea Kallikratia Beach, Artemis offers the perfect combination of coastal relaxation and modern convenience',
  map_query = '40.3147209,23.0626348',
  map_url = 'https://maps.app.goo.gl/dtuvB2uHHP5x8e1q6',
  characteristics = '[]'::jsonb,
  floor_plan_groups = (
    select coalesce(jsonb_agg(
      case ordinal
        when 1 then jsonb_set(item, '{title}', '"D16 - 66m²"'::jsonb)
        when 2 then jsonb_set(item, '{title}', '"D17 - 74m²"'::jsonb)
        when 3 then jsonb_set(item, '{title}', '"D18 - 94m²"'::jsonb)
        else item
      end
      order by ordinal
    ), '[]'::jsonb)
    from jsonb_array_elements(floor_plan_groups) with ordinality as groups(item, ordinal)
  ),
  benefits = (
    select coalesce(jsonb_agg(
      case when item->>'id' = 'availability'
        then jsonb_set(item, '{title}', '"Last 2 duplexes available"'::jsonb)
        else item
      end
      order by ordinal
    ), '[]'::jsonb)
    from jsonb_array_elements(benefits) with ordinality as entries(item, ordinal)
  )
where slug = 'artemis-residences';

update public.projects
set
  address = 'Monastiriou 4 · Thessaloniki City Center',
  card_address = 'Monastiriou 4 · Thessaloniki City Center',
  intro_title = 'A Strategic Location. A Smart Investment',
  full_description = E'In central Thessaloniki, a new residential concept—Monastiriou, 4 Residences—is transforming former commercial spaces into stylish contemporary homes\n\nLocated in very central high-demand district, the project offers strong rental potential (long- and short-term), proximity to key infrastructure, and steady demand from students, professionals, and tourists',
  map_query = '40.6411784,22.9344679',
  map_url = 'https://maps.app.goo.gl/J6eWmbBbo5d7uAWP8'
where slug = 'monastiriou-4-residences';

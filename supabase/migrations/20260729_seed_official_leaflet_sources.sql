-- Slevao.cz: výchozí oficiální zdroje letáků pro celou ČR
-- Vloží se pouze pro obchody, které už existují v tabulce stores.

with source_seed(slug, name, source_url, source_type, check_interval_minutes, auto_publish) as (
  values
    ('kaufland', 'Kaufland – oficiální aktuální letáky', 'https://prodejny.kaufland.cz/letak.html', 'html', 180, true),
    ('tesco', 'Tesco – akční letáky a katalogy', 'https://www.itesco.cz/akcni-nabidky/letaky-a-katalogy', 'html', 180, false),
    ('albert', 'Albert – aktuální letáky', 'https://www.albert.cz/aktualni-letaky', 'html', 180, false),
    ('penny', 'PENNY – aktuální letáky', 'https://www.penny.cz/letaky', 'html', 180, false),
    ('billa', 'BILLA – aktuální letáky', 'https://www.billa.cz/akcni-letaky', 'html', 180, false),
    ('globus', 'Globus – akční letáky', 'https://www.globus.cz/globus/letaky', 'html', 180, false),
    ('lidl', 'Lidl – akční leták', 'https://www.lidl.cz/c/akcni-letak/s10008880', 'html', 180, false),
    ('makro', 'MAKRO – aktuální nabídky', 'https://www.makro.cz/aktualni-nabidky', 'html', 360, false)
)
insert into public.leaflet_sources (
  store_id,
  name,
  source_url,
  source_type,
  is_active,
  auto_publish,
  check_interval_minutes,
  geographic_scope,
  country_code
)
select
  s.id,
  seed.name,
  seed.source_url,
  seed.source_type,
  true,
  seed.auto_publish,
  seed.check_interval_minutes,
  'national',
  'CZ'
from source_seed seed
join public.stores s on s.slug = seed.slug
on conflict (source_url) do update set
  store_id = excluded.store_id,
  name = excluded.name,
  source_type = excluded.source_type,
  is_active = true,
  check_interval_minutes = excluded.check_interval_minutes,
  geographic_scope = 'national',
  country_code = 'CZ',
  updated_at = now();

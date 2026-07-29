-- Slevao.cz: sjednocení zdrojů na stabilní oficiální stránky řetězců
-- Staré a chybné zdroje daného obchodu se vypnou, kanonický zdroj se vytvoří nebo aktualizuje.

with official_sources(slug, name, source_url, source_type, check_interval_minutes) as (
  values
    ('kaufland', 'Kaufland – oficiální aktuální letáky', 'https://prodejny.kaufland.cz/letak.html', 'html', 180),
    ('tesco', 'Tesco – akční letáky a katalogy', 'https://www.itesco.cz/akcni-nabidky/letaky-a-katalogy', 'html', 180),
    ('albert', 'Albert – aktuální letáky', 'https://www.albert.cz/aktualni-letaky', 'html', 180),
    ('penny', 'PENNY – aktuální letáky', 'https://www.penny.cz/letaky', 'html', 180),
    ('billa', 'BILLA – aktuální letáky', 'https://www.billa.cz/letaky-billa', 'html', 180),
    ('globus', 'Globus – akční letáky', 'https://www.globus.cz/globus/letaky', 'html', 180),
    ('lidl', 'Lidl – akční leták', 'https://www.lidl.cz/c/akcni-letak/s10008644', 'html', 180),
    ('makro', 'MAKRO – aktuální nabídky', 'https://www.makro.cz/aktualni-nabidky', 'html', 360)
), target_stores as (
  select s.id, s.slug, o.source_url
  from public.stores s
  join official_sources o on o.slug = s.slug
)
update public.leaflet_sources ls
set is_active = false,
    last_error = null,
    updated_at = now()
from target_stores t
where ls.store_id = t.id
  and ls.source_url <> t.source_url;

with official_sources(slug, name, source_url, source_type, check_interval_minutes) as (
  values
    ('kaufland', 'Kaufland – oficiální aktuální letáky', 'https://prodejny.kaufland.cz/letak.html', 'html', 180),
    ('tesco', 'Tesco – akční letáky a katalogy', 'https://www.itesco.cz/akcni-nabidky/letaky-a-katalogy', 'html', 180),
    ('albert', 'Albert – aktuální letáky', 'https://www.albert.cz/aktualni-letaky', 'html', 180),
    ('penny', 'PENNY – aktuální letáky', 'https://www.penny.cz/letaky', 'html', 180),
    ('billa', 'BILLA – aktuální letáky', 'https://www.billa.cz/letaky-billa', 'html', 180),
    ('globus', 'Globus – akční letáky', 'https://www.globus.cz/globus/letaky', 'html', 180),
    ('lidl', 'Lidl – akční leták', 'https://www.lidl.cz/c/akcni-letak/s10008644', 'html', 180),
    ('makro', 'MAKRO – aktuální nabídky', 'https://www.makro.cz/aktualni-nabidky', 'html', 360)
)
insert into public.leaflet_sources (
  store_id,
  name,
  source_url,
  source_type,
  is_active,
  auto_publish,
  check_interval_minutes,
  coverage_scope,
  last_checked_at,
  last_error
)
select
  s.id,
  o.name,
  o.source_url,
  o.source_type,
  true,
  true,
  o.check_interval_minutes,
  'national',
  null,
  null
from official_sources o
join public.stores s on s.slug = o.slug
on conflict (source_url) do update set
  store_id = excluded.store_id,
  name = excluded.name,
  source_type = excluded.source_type,
  is_active = true,
  auto_publish = true,
  check_interval_minutes = excluded.check_interval_minutes,
  coverage_scope = 'national',
  last_checked_at = null,
  last_error = null,
  updated_at = now();

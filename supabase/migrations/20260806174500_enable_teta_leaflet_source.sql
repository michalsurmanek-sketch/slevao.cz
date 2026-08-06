-- Slevao.cz: aktivace ověřeného zdroje Teta drogerie.
-- Specializovaný adaptér sync-teta-source zpracovává strukturované produkty
-- z oficiální stránky a ukládá je jako jeden aktuální leták.

update public.leaflet_sources ls
set is_active = false,
    updated_at = now()
from public.stores s
where ls.store_id = s.id
  and s.slug = 'teta';

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
  'Teta drogerie – aktuální akce a leták',
  'https://www.tetadrogerie.cz/akce',
  'html',
  true,
  false,
  360,
  'national',
  null,
  null
from public.stores s
where s.slug = 'teta'
on conflict (source_url) do update set
  store_id = excluded.store_id,
  name = excluded.name,
  source_type = excluded.source_type,
  is_active = true,
  auto_publish = false,
  check_interval_minutes = excluded.check_interval_minutes,
  coverage_scope = excluded.coverage_scope,
  last_checked_at = null,
  last_error = null,
  updated_at = now();

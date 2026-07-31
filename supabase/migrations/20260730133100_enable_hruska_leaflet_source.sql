-- Slevao.cz: Hruška – aktivace oficiálního zdroje letáku

update public.leaflet_sources ls
set
  source_url = 'https://mojehruska.cz/',
  source_type = 'html',
  is_active = true,
  auto_publish = false,
  check_interval_minutes = 360,
  coverage_scope = 'national',
  last_error = 'Čeká na první spuštění funkce discover-hruska',
  updated_at = now()
from public.stores s
where ls.store_id = s.id
  and s.slug = 'hruska';

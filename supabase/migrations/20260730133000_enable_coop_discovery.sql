-- Slevao.cz: COOP jako první nový samostatně zprovozněný obchod
-- Import se zapíná, automatické publikování zůstává vypnuté do první kontroly výsledků.

update public.leaflet_sources ls
set
  source_url = 'https://www.coopclub.cz/letaky/',
  source_type = 'html',
  is_active = true,
  auto_publish = false,
  check_interval_minutes = 360,
  coverage_scope = 'national',
  last_error = 'COOP adaptér připraven; čeká na první spuštění funkce discover-coop.',
  updated_at = now()
from public.stores s
where ls.store_id = s.id
  and s.slug = 'coop';

-- Pokud zdroj ještě neexistuje, vytvoří se bezpečně bez duplicit.
insert into public.leaflet_sources (
  store_id,
  name,
  source_url,
  source_type,
  is_active,
  auto_publish,
  check_interval_minutes,
  coverage_scope,
  last_error
)
select
  s.id,
  'COOP – aktuální letáky',
  'https://www.coopclub.cz/letaky/',
  'html',
  true,
  false,
  360,
  'national',
  'COOP adaptér připraven; čeká na první spuštění funkce discover-coop.'
from public.stores s
where s.slug = 'coop'
  and not exists (
    select 1
    from public.leaflet_sources existing
    where existing.store_id = s.id
  );

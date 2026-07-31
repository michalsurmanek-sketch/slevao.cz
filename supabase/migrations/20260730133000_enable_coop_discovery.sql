-- Slevao.cz: COOP jako první nový samostatně zprovozněný obchod
-- Import se zapíná, automatické publikování zůstává vypnuté do první kontroly výsledků.
-- Migrace je opakovatelná a bezpečně sloučí případný starší řádek se stejnou URL.

do $$
declare
  coop_store_id uuid;
  coop_source_id uuid;
  url_source_id uuid;
begin
  select id
  into coop_store_id
  from public.stores
  where slug = 'coop'
  limit 1;

  if coop_store_id is null then
    raise notice 'COOP obchod nebyl nalezen; migrace zdroje se přeskakuje.';
    return;
  end if;

  select id
  into coop_source_id
  from public.leaflet_sources
  where store_id = coop_store_id
  order by updated_at desc nulls last, id
  limit 1;

  select id
  into url_source_id
  from public.leaflet_sources
  where source_url = 'https://www.coopclub.cz/letaky/'
  order by updated_at desc nulls last, id
  limit 1;

  -- Existuje COOP řádek i jiný řádek se stejnou URL: cizí duplicitu odstraníme
  -- a zachováme stabilní COOP source id.
  if coop_source_id is not null then
    if url_source_id is not null and url_source_id <> coop_source_id then
      delete from public.leaflet_sources
      where id = url_source_id;
    end if;

    update public.leaflet_sources
    set
      name = 'COOP – aktuální letáky',
      source_url = 'https://www.coopclub.cz/letaky/',
      source_type = 'html',
      is_active = true,
      auto_publish = false,
      check_interval_minutes = 360,
      coverage_scope = 'national',
      last_error = 'COOP adaptér připraven; čeká na první spuštění funkce discover-coop.',
      updated_at = now()
    where id = coop_source_id;

  -- Existuje jen řádek s cílovou URL: převedeme ho pod COOP.
  elsif url_source_id is not null then
    update public.leaflet_sources
    set
      store_id = coop_store_id,
      name = 'COOP – aktuální letáky',
      source_type = 'html',
      is_active = true,
      auto_publish = false,
      check_interval_minutes = 360,
      coverage_scope = 'national',
      last_error = 'COOP adaptér připraven; čeká na první spuštění funkce discover-coop.',
      updated_at = now()
    where id = url_source_id;

  -- Neexistuje nic: vytvoříme jeden nový zdroj.
  else
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
    ) values (
      coop_store_id,
      'COOP – aktuální letáky',
      'https://www.coopclub.cz/letaky/',
      'html',
      true,
      false,
      360,
      'national',
      'COOP adaptér připraven; čeká na první spuštění funkce discover-coop.'
    );
  end if;
end
$$;

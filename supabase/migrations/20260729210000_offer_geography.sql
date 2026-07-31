-- Slevao.cz: územní platnost nabídek pro celou ČR, kraj, město nebo konkrétní prodejnu

alter table public.leaflet_sources
  add column if not exists coverage_scope text not null default 'national'
    check (coverage_scope in ('national','region','city','store')),
  add column if not exists region_code text,
  add column if not exists city_name text,
  add column if not exists store_location_name text;

alter table public.leaflet_imports
  add column if not exists coverage_scope text not null default 'national'
    check (coverage_scope in ('national','region','city','store')),
  add column if not exists region_code text,
  add column if not exists city_name text,
  add column if not exists store_location_name text;

alter table public.offers
  add column if not exists coverage_scope text not null default 'national'
    check (coverage_scope in ('national','region','city','store')),
  add column if not exists region_code text,
  add column if not exists city_name text,
  add column if not exists store_location_name text;

create index if not exists offers_coverage_idx
  on public.offers (coverage_scope, region_code, city_name, status, valid_to);

create index if not exists leaflet_sources_coverage_idx
  on public.leaflet_sources (coverage_scope, region_code, city_name, is_active);

-- Starší nabídky a zdroje jsou považovány za celostátní.
update public.offers set coverage_scope = 'national' where coverage_scope is null;
update public.leaflet_sources set coverage_scope = 'national' where coverage_scope is null;
update public.leaflet_imports set coverage_scope = 'national' where coverage_scope is null;

-- Veřejný lokalizovaný feed navazuje na existující active_offers a doplňuje geografii.
create or replace view public.localized_active_offers
with (security_invoker = true)
as
select
  ao.*,
  o.coverage_scope,
  o.region_code,
  o.city_name,
  o.store_location_name
from public.active_offers ao
join public.offers o on o.id = ao.id;

grant select on public.localized_active_offers to anon, authenticated;

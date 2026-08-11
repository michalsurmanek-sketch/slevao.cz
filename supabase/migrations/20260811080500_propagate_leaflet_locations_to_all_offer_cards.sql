-- Pokud mame pro produkt/obchod/platnost presne jednu overenou polohu v PDF,
-- propis ji i do offers.metadata. Homepage a stranky obchodu pak automaticky
-- zobrazi stejny prvek "Letak · strana N" jako detail produktu.

create or replace function public.apply_cached_leaflet_location_to_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_page integer;
  v_document_url text;
  v_count integer;
begin
  select
    min(loc.source_page),
    min(loc.document_url),
    count(distinct loc.source_page::text || '|' || loc.document_url)
  into v_page,v_document_url,v_count
  from public.offers o
  join public.public_product_leaflet_locations loc
    on loc.product_id = o.product_id
   and loc.store_id = o.store_id
   and loc.source_page between 1 and 500
   and loc.document_url ~* '^https://.*\.pdf(?:\?|$)'
   and loc.document_url !~* '/storage/v1/object/sign/'
   and (loc.valid_from is null or loc.valid_from <= o.valid_to)
   and (loc.valid_to is null or loc.valid_to >= o.valid_from)
  where o.id = p_offer_id
    and o.product_id is not null
    and o.status = 'published'
    and o.is_verified = true;

  if v_count <> 1 or v_page is null or v_document_url is null then
    return;
  end if;

  update public.offers
  set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
    'leaflet_page',v_page,
    'leaflet_document_url',v_document_url,
    'leaflet_location_source','product_leaflet_cache_v1'
  ),
  updated_at = now()
  where id = p_offer_id
    and (
      nullif(metadata->>'leaflet_page','') is null
      or nullif(metadata->>'leaflet_document_url','') is null
    );
end;
$$;

revoke all on function public.apply_cached_leaflet_location_to_offer(uuid) from public,anon,authenticated;

create or replace function public.offer_leaflet_location_sync_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.apply_cached_leaflet_location_to_offer(new.id);
  return new;
end;
$$;

revoke all on function public.offer_leaflet_location_sync_trigger() from public,anon,authenticated;

drop trigger if exists offer_leaflet_location_sync_trigger on public.offers;
create trigger offer_leaflet_location_sync_trigger
after insert or update of product_id,store_id,valid_from,valid_to,status,is_verified
on public.offers
for each row execute function public.offer_leaflet_location_sync_trigger();

create or replace function public.leaflet_cache_offer_sync_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer record;
begin
  for v_offer in
    select o.id
    from public.offers o
    where o.product_id = new.product_id
      and o.store_id = new.store_id
      and o.status = 'published'
      and o.is_verified = true
      and (new.valid_from is null or new.valid_from <= o.valid_to)
      and (new.valid_to is null or new.valid_to >= o.valid_from)
  loop
    perform public.apply_cached_leaflet_location_to_offer(v_offer.id);
  end loop;
  return new;
end;
$$;

revoke all on function public.leaflet_cache_offer_sync_trigger() from public,anon,authenticated;

drop trigger if exists leaflet_cache_offer_sync_trigger on public.public_product_leaflet_locations;
create trigger leaflet_cache_offer_sync_trigger
after insert or update of source_page,document_url,valid_from,valid_to
on public.public_product_leaflet_locations
for each row execute function public.leaflet_cache_offer_sync_trigger();

-- Backfill vsech aktualnich nabidek, ale pouze tam, kde existuje prave jedna
-- jednoznacna strana/dokument pro stejny produkt, obchod a prekryvajici se platnost.
do $$
declare
  v_offer record;
begin
  for v_offer in
    select id
    from public.offers
    where status='published'
      and is_verified=true
      and valid_to>=current_date
      and product_id is not null
  loop
    perform public.apply_cached_leaflet_location_to_offer(v_offer.id);
  end loop;
end;
$$;

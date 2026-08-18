alter table public.offers add column if not exists source_item_key text;
alter table public.offers add column if not exists source_occurrence_key text;

create or replace function public.set_offer_source_identity()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  store_slug text;
  clean_ean text;
begin
  new.source_item_key := null;
  new.source_occurrence_key := null;

  if nullif(btrim(coalesce(new.external_id,'')),'') is not null then
    new.source_item_key := 'external:' || btrim(new.external_id);
  else
    select s.slug into store_slug from public.stores s where s.id=new.store_id;
    if store_slug in ('dm','tesco') then
      clean_ean := nullif(regexp_replace(coalesce(new.metadata->>'incoming_ean',''),'\D','','g'),'');
      if clean_ean is not null and length(clean_ean) between 8 and 14 then
        new.source_item_key := 'ean:' || clean_ean;
      end if;
    end if;
  end if;

  if new.source_item_key is not null and new.valid_from is not null and new.valid_to is not null then
    new.source_occurrence_key := new.source_item_key || '|from:' || new.valid_from::text || '|to:' || new.valid_to::text;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_set_offer_source_identity on public.offers;
create trigger trg_set_offer_source_identity
before insert or update of store_id,external_id,metadata,valid_from,valid_to
on public.offers
for each row execute function public.set_offer_source_identity();

update public.offers o
set source_item_key = case
      when nullif(btrim(coalesce(o.external_id,'')),'') is not null then 'external:' || btrim(o.external_id)
      when s.slug in ('dm','tesco')
       and length(nullif(regexp_replace(coalesce(o.metadata->>'incoming_ean',''),'\D','','g'),'')) between 8 and 14
        then 'ean:' || regexp_replace(o.metadata->>'incoming_ean','\D','','g')
      else null
    end,
    source_occurrence_key = case
      when o.valid_from is not null and o.valid_to is not null and nullif(btrim(coalesce(o.external_id,'')),'') is not null
        then 'external:' || btrim(o.external_id) || '|from:' || o.valid_from::text || '|to:' || o.valid_to::text
      when o.valid_from is not null and o.valid_to is not null and s.slug in ('dm','tesco')
       and length(nullif(regexp_replace(coalesce(o.metadata->>'incoming_ean',''),'\D','','g'),'')) between 8 and 14
        then 'ean:' || regexp_replace(o.metadata->>'incoming_ean','\D','','g') || '|from:' || o.valid_from::text || '|to:' || o.valid_to::text
      else null
    end
from public.stores s
where s.id=o.store_id;

create index if not exists idx_offers_source_item_key
on public.offers(store_id,source_item_key)
where source_item_key is not null;

create unique index if not exists offers_published_source_occurrence_uidx
on public.offers(
  store_id,
  source_occurrence_key,
  coverage_scope,
  coalesce(region_code,''),
  coalesce(city_name,''),
  coalesce(store_location_name,'')
)
where status='published' and source_occurrence_key is not null;

create index if not exists leaflet_import_items_import_product_idx
on public.leaflet_import_items(import_id,product_id);

create or replace function public.set_offer_source_identity()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  store_slug text;
  clean_ean text;
  import_id_text text;
  matched_import_item uuid;
  import_item_count integer := 0;
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
  elsif new.product_id is not null then
    import_id_text := nullif(btrim(coalesce(new.metadata->>'import_id','')),'');
    if import_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select min(li.id::text)::uuid,count(*)
        into matched_import_item,import_item_count
      from public.leaflet_import_items li
      where li.import_id=import_id_text::uuid
        and li.product_id=new.product_id;
      if import_item_count=1 then
        new.source_occurrence_key := 'import-item:' || matched_import_item::text;
      end if;
    end if;
  end if;

  return new;
end;
$function$;

with mapped as (
  select o.id,min(li.id::text)::uuid as import_item_id
  from public.offers o
  join public.leaflet_import_items li
    on (o.metadata->>'import_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and li.import_id=(o.metadata->>'import_id')::uuid
   and li.product_id=o.product_id
  where o.source_item_key is null
  group by o.id
  having count(*)=1
)
update public.offers o
set source_occurrence_key='import-item:' || m.import_item_id::text
from mapped m
where o.id=m.id
  and o.source_item_key is null;

-- Extend package identity beyond g/kg/l/ml/ks. Retail offers commonly use
-- doses, rolls and packs; treating those as no quantity allowed generic master
-- matching to replace a stricter importer choice.
create or replace function public.product_quantity_key(value text)
returns text
language plpgsql
immutable
parallel safe
set search_path to 'public', 'pg_temp'
as $function$
declare
  source_text text := lower(unaccent(coalesce(value, '')));
  parts text[];
  unit_key text;
begin
  parts := regexp_match(
    source_text,
    '([0-9]+)\s*[x×]\s*([0-9]+(?:[.,][0-9]+)?)\s*(kg|g|mg|l|ml|cl|ks|kus|kusy|kusu|davka|davky|davek|role|roli|rol|baleni)'
  );
  if parts is not null then
    unit_key := case parts[3]
      when 'kus' then 'ks' when 'kusy' then 'ks' when 'kusu' then 'ks'
      when 'davky' then 'davka' when 'davek' then 'davka'
      when 'roli' then 'role' when 'rol' then 'role'
      when 'baleni' then 'bal'
      else parts[3]
    end;
    return parts[1] || 'x' || replace(parts[2], ',', '.') || unit_key;
  end if;

  parts := regexp_match(
    source_text,
    '([0-9]+(?:[.,][0-9]+)?)\s*(kg|g|mg|l|ml|cl|ks|kus|kusy|kusu|davka|davky|davek|role|roli|rol|baleni)'
  );
  if parts is not null then
    unit_key := case parts[2]
      when 'kus' then 'ks' when 'kusy' then 'ks' when 'kusu' then 'ks'
      when 'davky' then 'davka' when 'davek' then 'davka'
      when 'roli' then 'role' when 'rol' then 'role'
      when 'baleni' then 'bal'
      else parts[2]
    end;
    return replace(parts[1], ',', '.') || unit_key;
  end if;

  return null;
end;
$function$;

-- Re-apply the latest strict Albert import choice now that count packages are
-- recognized by the trigger guard.
with latest as (
  select li.id
  from public.leaflet_imports li
  join public.stores s on s.id = li.store_id
  where s.slug = 'albert'
    and li.status = 'published'
    and li.metadata ->> 'adapter' = 'albert-products-publitas-text-v4'
  order by li.finished_at desc nulls last, li.updated_at desc
  limit 1
), intended as (
  select
    (item.raw_data ->> 'offer_id')::uuid as offer_id,
    item.product_id
  from public.leaflet_import_items item
  join latest l on l.id = item.import_id
  where item.product_id is not null
    and coalesce(item.raw_data ->> 'offer_id', '') <> ''
)
update public.offers o
set product_id = i.product_id,
    catalog_match_status = 'matched',
    catalog_match_score = 1,
    catalog_checked_at = now(),
    updated_at = now()
from intended i
where o.id = i.offer_id
  and o.product_id is distinct from i.product_id
  and o.metadata ->> 'adapter' = 'albert-products-publitas-text-v4';

create or replace function public.propagate_globus_ean_to_product()
returns trigger
language plpgsql
security invoker
set search_path to 'public','pg_temp'
as $function$
declare
  v_ean text;
begin
  if new.product_id is null
     or new.is_verified is distinct from true
     or coalesce(new.metadata->>'adapter','') <> 'globus-action-products-api-v1' then
    return new;
  end if;

  v_ean := regexp_replace(coalesce(new.metadata->>'ean',''),'\D','','g');
  if v_ean !~ '^\d{8,14}$' then
    return new;
  end if;

  begin
    update public.products p
       set ean = v_ean,
           metadata = coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
             'ean_source','globus-offer-metadata',
             'ean_source_adapter','globus-action-products-api-v1',
             'ean_source_synced_at',now()
           ),
           updated_at = now()
     where p.id = new.product_id
       and nullif(trim(coalesce(p.ean,'')),'') is null
       and not exists (
         select 1 from public.products p2
         where p2.ean = v_ean and p2.id <> p.id
       );
  exception when unique_violation then
    return new;
  end;

  return new;
end;
$function$;

revoke all on function public.propagate_globus_ean_to_product() from public, anon, authenticated;

drop trigger if exists propagate_globus_ean_to_product_trg on public.offers;
create trigger propagate_globus_ean_to_product_trg
after insert or update of product_id, is_verified, metadata
on public.offers
for each row execute function public.propagate_globus_ean_to_product();

with src as (
  select distinct on (o.product_id)
         o.product_id,
         regexp_replace(coalesce(o.metadata->>'ean',''),'\D','','g') as ean
  from public.offers o
  join public.stores s on s.id=o.store_id
  where s.slug='globus'
    and o.status='published'
    and o.is_verified=true
    and o.metadata->>'adapter'='globus-action-products-api-v1'
    and regexp_replace(coalesce(o.metadata->>'ean',''),'\D','','g') ~ '^\d{8,14}$'
  order by o.product_id,o.updated_at desc
)
update public.products p
   set ean=src.ean,
       metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object(
         'ean_source','globus-offer-metadata-backfill',
         'ean_source_adapter','globus-action-products-api-v1',
         'ean_source_synced_at',now()
       ),
       updated_at=now()
from src
where p.id=src.product_id
  and nullif(trim(coalesce(p.ean,'')),'') is null
  and not exists (
    select 1 from public.products p2
    where p2.ean=src.ean and p2.id<>p.id
  );

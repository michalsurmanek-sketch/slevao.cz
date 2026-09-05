with provenance as (
  select p.id,min(s.slug) as store_slug
  from public.products p
  join public.offers o on o.product_id=p.id and o.is_verified is true
  join public.stores s on s.id=o.store_id
  where p.is_active is true
    and p.filter_group is null
  group by p.id
  having count(distinct s.slug)=1
)
update public.products p
set metadata=coalesce(p.metadata,'{}'::jsonb)
  || jsonb_build_object(
    'source_store_slug',provenance.store_slug,
    'source_store_backfilled_at',now(),
    'source_store_backfill_source','single-verified-store-v1'
  )
from provenance
where p.id=provenance.id
  and nullif(trim(coalesce(p.metadata->>'source_store_slug','')),'') is null;
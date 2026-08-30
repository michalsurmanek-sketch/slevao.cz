-- One-time audited backfill for current verified offers on 2026-08-30.
-- The products trigger applies classifier v34; explicit classifications are not touched.
with target as (
  select distinct p.id
  from public.offers o
  join public.products p on p.id=o.product_id
  where o.status='published'
    and o.is_verified=true
    and o.valid_from<=date '2026-08-30'
    and o.valid_to>=date '2026-08-30'
    and (p.filter_group is null or btrim(p.filter_group)='')
    and public.infer_product_filter_group_gap_v34(p.name,p.quantity_text,p.metadata) <> 'other'
)
update public.products p
set metadata=coalesce(p.metadata,'{}'::jsonb)
  || jsonb_build_object('filter_group_v34_backfill_requested_at',now())
from target t
where p.id=t.id;

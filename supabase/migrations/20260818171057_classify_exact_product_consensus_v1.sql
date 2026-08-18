with active_targets as (
  select distinct p.id, p.normalized_name, p.brand, p.quantity_text
  from public.products p
  join public.active_offers ao on ao.product_id = p.id
  where p.is_active = true
    and p.category_id is null
    and nullif(btrim(p.normalized_name), '') is not null
), evidence as (
  select
    t.id as product_id,
    count(distinct c.category_id) as category_count,
    min(c.category_id::text)::uuid as category_id,
    count(*) as evidence_rows
  from active_targets t
  join public.products c
    on c.id <> t.id
   and c.category_id is not null
   and c.normalized_name = t.normalized_name
   and coalesce(nullif(lower(btrim(c.brand)), ''), '') = coalesce(nullif(lower(btrim(t.brand)), ''), '')
   and coalesce(nullif(lower(btrim(c.quantity_text)), ''), '') = coalesce(nullif(lower(btrim(t.quantity_text)), ''), '')
  group by t.id
), safe as (
  select product_id, category_id
  from evidence
  where category_count = 1
    and evidence_rows >= 3
)
update public.products p
set category_id = s.category_id,
    classification_confidence = greatest(coalesce(p.classification_confidence, 0), 0.99),
    classification_source = 'exact-product-consensus-v1',
    classified_at = now(),
    updated_at = now()
from safe s
where p.id = s.product_id
  and p.category_id is null;

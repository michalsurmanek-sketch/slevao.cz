create or replace view public.product_equivalence_review_queue
with (security_invoker = true)
as
with recent as (
  select distinct on (o.product_id,o.store_id)
    o.product_id,
    o.store_id,
    s.name as store_name,
    o.title as offer_title,
    o.valid_from,
    o.valid_to,
    p.name as product_name,
    p.normalized_name,
    p.brand,
    p.quantity_text,
    public.normalize_product_name(p.brand) as brand_key,
    public.product_quantity_key(coalesce(p.quantity_text,o.title)) as quantity_key
  from public.offers o
  join public.products p on p.id=o.product_id
  join public.stores s on s.id=o.store_id
  where o.product_id is not null
    and o.is_verified = true
    and o.catalog_match_status in ('matched','retained')
    and o.valid_to >= current_date - 90
    and nullif(trim(p.brand),'') is not null
    and public.product_quantity_key(coalesce(p.quantity_text,o.title)) is not null
  order by o.product_id,o.store_id,o.valid_to desc,o.updated_at desc
), pairs as (
  select
    a.product_id as product_id_a,
    b.product_id as product_id_b,
    a.product_name as product_name_a,
    b.product_name as product_name_b,
    a.brand,
    a.quantity_key,
    a.store_name as store_a,
    b.store_name as store_b,
    a.offer_title as offer_title_a,
    b.offer_title as offer_title_b,
    greatest(a.valid_to,b.valid_to) as latest_valid_to
  from recent a
  join recent b
    on a.brand_key=b.brand_key
   and a.quantity_key=b.quantity_key
   and a.product_id::text < b.product_id::text
   and a.store_id <> b.store_id
)
select distinct
  p.product_id_a,
  p.product_id_b,
  p.product_name_a,
  p.product_name_b,
  p.brand,
  p.quantity_key,
  p.store_a,
  p.store_b,
  p.offer_title_a,
  p.offer_title_b,
  p.latest_valid_to,
  'manual_review_required'::text as review_status
from pairs p
where not exists (
  select 1
  from public.product_equivalences e
  where e.is_active=true
    and least(e.product_id_a,e.product_id_b)=least(p.product_id_a,p.product_id_b)
    and greatest(e.product_id_a,e.product_id_b)=greatest(p.product_id_a,p.product_id_b)
);

revoke all on public.product_equivalence_review_queue from anon, authenticated;

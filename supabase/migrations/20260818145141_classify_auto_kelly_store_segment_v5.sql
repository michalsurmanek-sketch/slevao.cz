with auto_category as (
  select id from public.categories where slug = 'auto' limit 1
), target_products as (
  select distinct p.id
  from public.products p
  join public.offers o on o.product_id = p.id
  join public.stores s on s.id = o.store_id
  where p.category_id is null
    and s.slug = 'auto-kelly'
)
update public.products p
set category_id = ac.id,
    filter_group = 'auto',
    filter_tags = array['auto']::text[],
    classification_confidence = 0.990,
    classification_source = 'store-segment-v5',
    metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object(
      'classification_version', 'store-segment-v5',
      'classification_reason', 'pure-automotive-retailer'
    )
from auto_category ac
where p.id in (select id from target_products)
  and p.category_id is null;

refresh materialized view private.public_offer_search_cache;

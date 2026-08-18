with fashion_category as (
  select id from public.categories where slug = 'moda' limit 1
), target_products as (
  select distinct p.id
  from public.products p
  join public.offers o on o.product_id = p.id
  join public.stores s on s.id = o.store_id
  where p.category_id is null
    and s.slug in ('cropp','reserved','house','takko')
)
update public.products p
set category_id = fc.id,
    filter_group = 'fashion',
    filter_tags = array['moda']::text[],
    classification_confidence = 0.990,
    classification_source = 'store-segment-v4',
    metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object(
      'classification_version', 'store-segment-v4',
      'classification_reason', 'pure-fashion-retailer'
    )
from fashion_category fc
where p.id in (select id from target_products);

refresh materialized view private.public_offer_search_cache;

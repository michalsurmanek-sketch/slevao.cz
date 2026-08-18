with category_map as (
  select * from (values
    ('fashion'::text, 'moda'::text, 'moda'::text),
    ('drugstore'::text, 'drogerie'::text, 'drogerie'::text),
    ('garden'::text, 'zahrada'::text, 'zahrada'::text),
    ('pets'::text, 'zvirata'::text, 'zvirata'::text)
  ) as x(filter_group, category_slug, filter_tag)
), candidates as (
  select c.product_id, min(c.effective_filter_group) as filter_group
  from private.public_offer_search_cache c
  where c.product_id is not null
    and c.category_id is null
  group by c.product_id
  having count(distinct c.effective_filter_group) = 1
     and min(c.effective_filter_group) in ('fashion','drugstore','garden','pets')
), resolved as (
  select ca.product_id, ca.filter_group, cm.filter_tag, cat.id as category_id
  from candidates ca
  join category_map cm on cm.filter_group = ca.filter_group
  join public.categories cat on cat.slug = cm.category_slug
)
update public.products p
set category_id = r.category_id,
    filter_group = r.filter_group,
    filter_tags = array[r.filter_tag]::text[],
    classification_confidence = 0.960,
    classification_source = 'public-group-consensus-v1',
    metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object(
      'classification_version', 'public-group-consensus-v1',
      'classification_reason', 'single-public-filter-group-consensus'
    )
from resolved r
where p.id = r.product_id
  and p.category_id is null;

refresh materialized view private.public_offer_search_cache;

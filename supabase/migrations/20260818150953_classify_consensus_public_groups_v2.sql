with category_map as (
  select slug,id from public.categories where slug in ('napoje','drogerie','lekarna')
), consensus as (
  select product_id, (array_agg(distinct effective_filter_group))[1] as grp
  from private.public_offer_search_cache
  where category_id is null and product_id is not null
  group by product_id
  having cardinality(array_agg(distinct effective_filter_group)) = 1
     and (array_agg(distinct effective_filter_group))[1] in ('drinks','drugstore','pharmacy')
), mapped as (
  select c.product_id,
         case c.grp when 'drinks' then 'napoje' when 'drugstore' then 'drogerie' when 'pharmacy' then 'lekarna' end as category_slug,
         c.grp
  from consensus c
)
update public.products p
set category_id = cm.id,
    filter_group = m.grp,
    filter_tags = case m.grp when 'drinks' then array['napoje']::text[] when 'drugstore' then array['drogerie']::text[] when 'pharmacy' then array['lekarna']::text[] end,
    classification_confidence = 0.96,
    classification_source = 'public-group-consensus-v2',
    metadata = coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object('classification_reason','single-public-group-consensus-v2')
from mapped m
join category_map cm on cm.slug = m.category_slug
where p.id = m.product_id
  and p.category_id is null;

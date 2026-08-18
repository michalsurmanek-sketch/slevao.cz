with live as (
  select distinct p.id,p.name
  from products p
  join offers o on o.product_id=p.id
  where p.category_id is null
    and p.is_active is true
    and o.status='published'
    and o.is_verified is true
    and (o.valid_to is null or o.valid_to>=current_date)
), classified as (
  select id, public.infer_public_filter_group(name,null) grp
  from live
), mapped as (
  select c.id product_id, cat.id category_id, c.grp
  from classified c
  join categories cat on cat.slug = case c.grp
    when 'drinks' then 'napoje'
    when 'drugstore' then 'drogerie'
    when 'pets' then 'zvirata'
    else null end
  where c.grp in ('drinks','drugstore','pets')
)
update products p
set category_id=m.category_id,
    filter_group=m.grp,
    filter_tags=array[m.grp]::text[],
    classification_confidence=0.97,
    classification_source='public-filter-group-exact-v2',
    updated_at=now()
from mapped m
where p.id=m.product_id and p.category_id is null;

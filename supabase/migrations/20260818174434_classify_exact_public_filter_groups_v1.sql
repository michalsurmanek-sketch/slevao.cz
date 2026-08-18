with candidates as (
  select distinct p.id,
    public.infer_public_filter_group(p.name,null) as grp,
    case public.infer_public_filter_group(p.name,null)
      when 'drinks' then 'napoje'
      when 'drugstore' then 'drogerie'
      when 'fashion' then 'moda'
      when 'garden' then 'zahrada'
      when 'pets' then 'zvirata'
    end as category_slug
  from public.products p
  join public.offers o on o.product_id=p.id
  where p.category_id is null
    and p.is_active is true
    and o.status='published'
    and o.is_verified is true
    and (o.valid_to is null or o.valid_to>=current_date)
    and public.infer_public_filter_group(p.name,null) in ('drinks','drugstore','fashion','garden','pets')
), mapped as (
  select c.id,c.grp,cat.id as category_id,c.category_slug
  from candidates c
  join public.categories cat on cat.slug=c.category_slug
)
update public.products p
set category_id=m.category_id,
    filter_group=m.grp,
    filter_tags=array[m.category_slug]::text[],
    classification_confidence=0.97,
    classification_source='public-filter-group-exact-v1'
from mapped m
where p.id=m.id and p.category_id is null;

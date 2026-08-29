update public.products p
set metadata = coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object('source_store_slug', src.store_slug)
from (
  select p2.id, min(s.slug) as store_slug
  from public.products p2
  join public.offers o on o.product_id=p2.id
  join public.stores s on s.id=o.store_id
  where s.slug in ('dm','pepco','terno','rossmann','billa','jip','lidl','teta')
    and o.status='published'
    and coalesce(o.valid_from,current_date)<=current_date
    and coalesce(o.valid_to,current_date)>=current_date
    and coalesce(p2.metadata->>'source_store_slug','')=''
    and coalesce(nullif(trim(p2.filter_group),''),'other')='other'
  group by p2.id
  having count(distinct s.slug)=1
) src
where p.id=src.id;

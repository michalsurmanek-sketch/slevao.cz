-- Fill missing category_id only when the existing filter_group agrees with
-- preview_product_taxonomy() and the classifier confidence is at least 0.97.
with active_products as materialized (
  select distinct p.id,p.filter_group
  from public.products p
  join public.offers o on o.product_id=p.id
  where p.is_active=true
    and p.category_id is null
    and o.status='published'
    and o.valid_from <= (now() at time zone 'Europe/Prague')::date
    and o.valid_to >= (now() at time zone 'Europe/Prague')::date
), candidates as materialized (
  select a.id as product_id,c.id as target_category_id,x.confidence,x.source
  from active_products a
  join lateral public.preview_product_taxonomy(a.id) x on true
  join public.categories c on c.slug=x.category_slug and c.is_active=true
  where x.confidence>=0.97
    and a.filter_group=x.filter_group
)
update public.products p
set category_id=c.target_category_id,
    classification_confidence=greatest(coalesce(p.classification_confidence,0),c.confidence),
    classification_source=coalesce(p.classification_source,'taxonomy-preview-category-reconcile:'||c.source),
    classified_at=coalesce(p.classified_at,now()),
    updated_at=now()
from candidates c
where p.id=c.product_id
  and p.category_id is null;

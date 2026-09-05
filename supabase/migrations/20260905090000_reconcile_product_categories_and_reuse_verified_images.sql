-- Reconcile category_id from already-established filter_group values.
-- Only exact one-to-one mappings are applied; broad groups such as food are intentionally excluded.
with mapping(filter_group,slug) as (values
  ('drugstore','drogerie'),
  ('drinks','napoje'),
  ('home','domacnost'),
  ('fashion','moda'),
  ('electronics','elektronika'),
  ('pharmacy','lekarna'),
  ('pets','zvirata'),
  ('auto','auto'),
  ('garden','zahrada')
)
update public.products p
set category_id=c.id,
    classification_confidence=greatest(coalesce(p.classification_confidence,0),0.99),
    classification_source=coalesce(p.classification_source,'filter-group-category-reconcile-v1'),
    classified_at=coalesce(p.classified_at,now()),
    updated_at=now()
from mapping m
join public.categories c on c.slug=m.slug and c.is_active=true
where p.category_id is null
  and p.is_active=true
  and p.filter_group=m.filter_group;

-- Reuse only already-verified generic product images.
-- best_reusable_generic_product_image() enforces an exact normalized-name key,
-- brandless products, image_verified=true, image_quality>=70 and excludes leaflet crops.
with missing as materialized (
  select distinct p.id,p.name,p.brand
  from public.products p
  join public.offers o on o.product_id=p.id
  where p.is_active=true
    and coalesce(trim(p.image_url),'')=''
    and coalesce(trim(o.image_url),'')=''
    and o.status='published'
    and o.valid_from <= (now() at time zone 'Europe/Prague')::date
    and o.valid_to >= (now() at time zone 'Europe/Prague')::date
), reusable as materialized (
  select m.id,r.image_url,r.image_source,r.image_quality,r.source_product_id
  from missing m
  join lateral public.best_reusable_generic_product_image(m.name,m.brand,m.id) r on true
)
update public.products p
set image_url=r.image_url,
    image_source=coalesce(r.image_source,r.image_url),
    image_quality=greatest(coalesce(r.image_quality,0),70),
    image_verified=true,
    image_checked_at=now(),
    metadata=coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
      'image_reused_from_product_id',r.source_product_id::text,
      'image_reuse_key',public.generic_product_image_key(p.name),
      'image_reused_at',now()
    ),
    updated_at=now()
from reusable r
where p.id=r.id
  and coalesce(trim(p.image_url),'')='';

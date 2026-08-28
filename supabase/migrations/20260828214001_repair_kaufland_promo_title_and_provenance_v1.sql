-- Reject promo-only Kaufland rows that were accidentally published as products,
-- and restore explicit Kaufland provenance for SSR-created products.

update public.products
set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
  'source_store_slug','kaufland',
  'source_store_slug_source','kaufland_ssr_metadata',
  'source_store_slug_backfilled_at',now()
)
where coalesce((metadata->>'created_from_kaufland_ssr')::boolean,false)=true
  and nullif(metadata->>'source_store_slug','') is null;

update public.offers o
set status='rejected',
    metadata=coalesce(o.metadata,'{}'::jsonb) || jsonb_build_object(
      'rejection_reason','promo_only_product_title',
      'rejected_at',now(),
      'parser_fix','kaufland-title-v10'
    )
from public.products p, public.stores s
where o.product_id=p.id
  and o.store_id=s.id
  and s.slug='kaufland'
  and o.status='published'
  and coalesce(o.metadata->>'adapter','')='kaufland-products-v4-ssr'
  and public.normalize_text(p.name)='tvoje cena s kaufland card';

update public.products p
set metadata=coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
  'invalid_product_title',true,
  'invalid_product_title_reason','promo_only_kaufland_card_label',
  'invalid_product_title_marked_at',now(),
  'parser_fix','kaufland-title-v10'
)
where coalesce((p.metadata->>'created_from_kaufland_ssr')::boolean,false)=true
  and public.normalize_text(p.name)='tvoje cena s kaufland card';

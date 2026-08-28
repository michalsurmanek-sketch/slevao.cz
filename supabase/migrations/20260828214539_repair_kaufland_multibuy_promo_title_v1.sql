-- Reject Kaufland SSR rows where a multibuy promotion was parsed as the product title.

update public.offers o
set status='rejected',
    metadata=coalesce(o.metadata,'{}'::jsonb) || jsonb_build_object(
      'rejection_reason','promo_only_multibuy_title',
      'rejected_at',now(),
      'parser_fix','kaufland-title-v11'
    )
from public.products p, public.stores s
where o.product_id=p.id
  and o.store_id=s.id
  and s.slug='kaufland'
  and o.status='published'
  and coalesce(o.metadata->>'adapter','')='kaufland-products-v4-ssr'
  and public.normalize_text(p.name) ~ '^pri koupi [0-9]+ (kus|kusu|kusy) .+ zdarma$';

update public.products p
set metadata=coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
  'invalid_product_title',true,
  'invalid_product_title_reason','promo_only_kaufland_multibuy_label',
  'invalid_product_title_marked_at',now(),
  'parser_fix','kaufland-title-v11'
)
where coalesce((p.metadata->>'created_from_kaufland_ssr')::boolean,false)=true
  and public.normalize_text(p.name) ~ '^pri koupi [0-9]+ (kus|kusu|kusy) .+ zdarma$';

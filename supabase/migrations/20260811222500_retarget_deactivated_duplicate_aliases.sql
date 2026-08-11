-- The conservative duplicate cleanup deactivated unused duplicate products,
-- but product_aliases itself is a reference and could still make a matcher
-- rediscover the inactive row. Move those aliases to the surviving exact
-- identity and tombstone the inactive normalized_name so direct lookup cannot
-- select it later.

create temporary table _duplicate_alias_mapping on commit drop as
select
  old.id as old_product_id,
  canonical.id as canonical_product_id,
  old.normalized_name as original_normalized_name
from public.products old
cross join lateral (
  select p.id
  from public.products p
  where p.is_active = true
    and p.normalized_name = old.normalized_name
    and coalesce(lower(btrim(p.brand)), '') = coalesce(lower(btrim(old.brand)), '')
    and coalesce(public.product_quantity_key(p.quantity_text), '') = coalesce(public.product_quantity_key(old.quantity_text), '')
  order by
    p.is_verified desc,
    p.image_verified desc,
    (p.image_url is not null) desc,
    p.created_at,
    p.id
  limit 1
) canonical
where old.is_active = false
  and old.metadata ->> '_duplicate_deactivation_policy' = 'unused_exact_identity_v1'
  and coalesce(old.metadata ->> 'structured_identity_key','') = ''
  and coalesce(old.metadata ->> 'kaufland_kl_nr','') = '';

insert into public.product_aliases(
  product_id,alias,normalized_alias,brand,quantity_text,source_store_id,confidence,created_at,updated_at
)
select
  m.canonical_product_id,
  a.alias,
  a.normalized_alias,
  a.brand,
  a.quantity_text,
  a.source_store_id,
  a.confidence,
  a.created_at,
  now()
from public.product_aliases a
join _duplicate_alias_mapping m on m.old_product_id = a.product_id
on conflict(product_id,normalized_alias)
do update set
  confidence = greatest(public.product_aliases.confidence, excluded.confidence),
  brand = coalesce(public.product_aliases.brand, excluded.brand),
  quantity_text = coalesce(public.product_aliases.quantity_text, excluded.quantity_text),
  source_store_id = coalesce(public.product_aliases.source_store_id, excluded.source_store_id),
  updated_at = now();

delete from public.product_aliases a
using _duplicate_alias_mapping m
where a.product_id = m.old_product_id;

update public.products p
set normalized_name = '__inactive_duplicate__:' || p.id::text,
    metadata = coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
      '_duplicate_original_normalized_name',m.original_normalized_name,
      '_duplicate_canonical_product_id',m.canonical_product_id,
      '_duplicate_aliases_retargeted_at',now()
    ),
    updated_at = now()
from _duplicate_alias_mapping m
where p.id = m.old_product_id;

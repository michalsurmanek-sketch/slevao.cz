-- Conservative catalogue cleanup: deactivate only duplicate product rows that
-- are completely unused, unverified, have no image and carry no protected
-- retailer identity. One best canonical row per exact name/brand/package group
-- always remains active.

with base as (
  select
    p.id,
    p.normalized_name,
    coalesce(lower(btrim(p.brand)), '') as brand_key,
    coalesce(public.product_quantity_key(p.quantity_text), '') as qty_key,
    p.is_verified,
    p.image_verified,
    p.image_url,
    p.metadata,
    p.created_at,
    exists (
      select 1 from public.offers o
      where o.product_id = p.id
        and o.status = 'published'
        and o.valid_to >= (now() at time zone 'Europe/Prague')::date
    ) as has_live_offer,
    (
      exists(select 1 from public.offers x where x.product_id=p.id)
      or exists(select 1 from public.price_history x where x.product_id=p.id)
      or exists(select 1 from public.leaflet_import_items x where x.product_id=p.id)
      or exists(select 1 from public.import_items x where x.product_id=p.id)
      or exists(select 1 from public.shopping_list_items x where x.product_id=p.id)
      or exists(select 1 from public.price_alerts x where x.product_id=p.id)
      or exists(select 1 from public.product_favorites x where x.product_id=p.id)
      or exists(select 1 from public.recently_viewed_products x where x.product_id=p.id)
      or exists(select 1 from public.notifications x where x.product_id=p.id)
      or exists(select 1 from public.offer_reports x where x.product_id=p.id)
      or exists(select 1 from public.public_product_leaflet_locations x where x.product_id=p.id)
      or exists(select 1 from public.product_image_candidates x where x.product_id=p.id)
      or exists(select 1 from public.product_image_generation_jobs x where x.product_id=p.id)
      or exists(select 1 from public.product_image_library x where x.product_id=p.id)
    ) as has_any_reference
  from public.products p
  where p.is_active = true
    and coalesce(p.normalized_name, '') <> ''
), ranked as (
  select
    b.*,
    count(*) over(partition by normalized_name,brand_key,qty_key) as group_size,
    row_number() over(
      partition by normalized_name,brand_key,qty_key
      order by
        has_live_offer desc,
        has_any_reference desc,
        is_verified desc,
        image_verified desc,
        (image_url is not null) desc,
        created_at,
        id
    ) as canonical_rank
  from base b
), safe_duplicates as (
  select id
  from ranked
  where group_size > 1
    and canonical_rank > 1
    and has_any_reference = false
    and is_verified = false
    and image_verified = false
    and image_url is null
    and coalesce(metadata ->> 'structured_identity_key','') = ''
    and coalesce(metadata ->> 'kaufland_kl_nr','') = ''
)
update public.products p
set is_active = false,
    metadata = coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
      '_duplicate_deactivated_at', now(),
      '_duplicate_deactivation_policy', 'unused_exact_identity_v1'
    ),
    updated_at = now()
from safe_duplicates d
where p.id = d.id;

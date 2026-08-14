-- Product images are identity-bearing data. Reusing an image solely by a generic,
-- unbranded name caused unrelated variants (for example different cat foods or
-- olive oils) to share one package image. Keep reuse scoped to the same product.

drop trigger if exists products_reuse_generic_image_trigger on public.products;

create or replace function public.active_verified_product_image(p_product_id uuid)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (
      select l.image_url
      from public.product_image_library l
      where l.product_id = p_product_id
        and l.is_active = true
        and l.quality_score >= 70
      order by l.quality_score desc, l.approved_at desc
      limit 1
    ),
    (
      select p.image_url
      from public.products p
      where p.id = p_product_id
        and p.image_verified = true
        and coalesce(p.image_quality, 0) >= 70
        and nullif(btrim(p.image_url), '') is not null
        and p.image_url not like '%/leaflet-crops/%'
    )
  );
$$;

create temporary table unsafe_generic_product_images on commit drop as
select
  target.id as product_id,
  target.image_url
from public.products target
join public.products source
  on source.id = nullif(target.metadata ->> 'image_reused_from_product_id', '')::uuid
 and source.image_url = target.image_url
where target.metadata ? 'image_reused_from_product_id'
  and nullif(btrim(target.image_url), '') is not null;

delete from public.product_image_library library
using unsafe_generic_product_images unsafe
where library.product_id = unsafe.product_id
  and library.image_url = unsafe.image_url;

update public.products product
set image_url = null,
    image_source = null,
    image_quality = 0,
    image_verified = false,
    image_checked_at = now(),
    metadata = (coalesce(product.metadata, '{}'::jsonb)
      - 'image_reused_from_product_id'
      - 'image_reuse_key') || jsonb_build_object(
        'unsafe_generic_image_removed_at', now(),
        'unsafe_generic_image_rule_version', 2
      ),
    updated_at = now()
from unsafe_generic_product_images unsafe
where product.id = unsafe.product_id
  and product.image_url = unsafe.image_url;

update public.offers offer
set image_url = null,
    metadata = (coalesce(offer.metadata, '{}'::jsonb)
      - 'image_backfill'
      - 'image_backfilled_at'
      - 'image_quality') || jsonb_build_object(
        'unsafe_generic_image_removed_at', now()
      ),
    updated_at = now()
from unsafe_generic_product_images unsafe
where offer.product_id = unsafe.product_id
  and offer.image_url = unsafe.image_url;

update public.leaflet_import_items item
set image_url = null,
    raw_data = coalesce(item.raw_data, '{}'::jsonb) || jsonb_build_object(
      'unsafe_generic_image_removed_at', now()
    )
from unsafe_generic_product_images unsafe
where item.product_id = unsafe.product_id
  and item.image_url = unsafe.image_url;

revoke all on function public.active_verified_product_image(uuid) from public, anon, authenticated;
grant execute on function public.active_verified_product_image(uuid) to service_role;


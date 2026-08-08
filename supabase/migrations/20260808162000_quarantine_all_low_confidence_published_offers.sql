-- A low-confidence parser-created product must not keep an unverified public offer,
-- regardless of which historical recovery path published it.

update public.offers o
set status = 'review',
    metadata = coalesce(o.metadata, '{}'::jsonb) || jsonb_build_object(
      '_quality_quarantined_at', now(),
      '_quality_quarantine_reason', 'unverified_product_confidence_lte_058'
    ),
    updated_at = now()
from public.products p
where p.id = o.product_id
  and o.status = 'published'
  and o.valid_to >= (now() at time zone 'Europe/Prague')::date
  and coalesce(o.is_verified, false) = false
  and coalesce(p.is_verified, false) = false
  and coalesce((p.metadata ->> 'source_confidence')::numeric, 0) > 0
  and coalesce((p.metadata ->> 'source_confidence')::numeric, 0) <= 0.58;

update public.products p
set is_active = false,
    metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object(
      '_quality_quarantined_at', now(),
      '_quality_quarantine_reason', 'low_confidence_product_without_trusted_offer'
    ),
    updated_at = now()
where coalesce(p.is_verified, false) = false
  and coalesce((p.metadata ->> 'source_confidence')::numeric, 0) > 0
  and coalesce((p.metadata ->> 'source_confidence')::numeric, 0) <= 0.58
  and not exists (
    select 1
    from public.offers o
    where o.product_id = p.id
      and o.status = 'published'
      and o.valid_to >= (now() at time zone 'Europe/Prague')::date
  );
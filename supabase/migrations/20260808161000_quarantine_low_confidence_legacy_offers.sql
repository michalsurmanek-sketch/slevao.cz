-- Prevent bulk-reset recovery from republishing unverified legacy OCR/parser data.
-- Existing low-confidence recovered offers are moved to review, not deleted.

create or replace function public.restore_offer_bulk_reset(p_store_slugs text[] default null::text[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  affected integer := 0;
  touched_runs uuid[] := array[]::uuid[];
begin
  with candidates as materialized (
    select
      o.id,
      (o.metadata ->> '_bulk_reset_run_id')::uuid as run_id,
      case
        when o.valid_to < (now() at time zone 'Europe/Prague')::date
             and o.metadata ->> '_bulk_reset_previous_status' = 'published'
          then 'expired'
        when o.metadata ->> '_bulk_reset_previous_status' = 'published'
             and (coalesce(o.is_verified, false) or coalesce(p.is_verified, false))
          then 'published'
        when o.metadata ->> '_bulk_reset_previous_status' = 'published'
          then 'review'
        when o.metadata ->> '_bulk_reset_previous_status' in
             ('draft','review','expired','rejected','error')
          then o.metadata ->> '_bulk_reset_previous_status'
        else 'draft'
      end as restore_status
    from public.offers o
    join public.stores s on s.id = o.store_id
    left join public.products p on p.id = o.product_id
    where o.status = 'trash'
      and o.metadata ? '_bulk_reset_run_id'
      and o.metadata ? '_bulk_reset_previous_status'
      and (p_store_slugs is null or s.slug = any(p_store_slugs))
  ), restored as (
    update public.offers o
    set status = c.restore_status,
        metadata = (
          o.metadata
          - '_bulk_reset_run_id'
          - '_bulk_reset_previous_status'
          - '_bulk_reset_requested_at'
        ) || jsonb_build_object(
          '_bulk_reset_restored_at', now(),
          '_bulk_reset_quality_checked', true
        ),
        published_at = case
          when c.restore_status = 'published' then coalesce(o.published_at, now())
          else o.published_at
        end,
        updated_at = now()
    from candidates c
    where o.id = c.id
    returning c.run_id
  ), counts as (
    select run_id, count(*)::integer as restored_count
    from restored
    group by run_id
  ), updated_runs as (
    update public.offer_bulk_reset_runs r
    set restored_count = r.restored_count + c.restored_count
    from counts c
    where r.id = c.run_id
    returning r.id
  )
  select
    coalesce(sum(c.restored_count), 0)::integer,
    coalesce(array_agg(c.run_id), array[]::uuid[])
  into affected, touched_runs
  from counts c;

  update public.offer_bulk_reset_runs r
  set status = case
        when exists (
          select 1
          from public.offers o
          where o.status = 'trash'
            and o.metadata ->> '_bulk_reset_run_id' = r.id::text
        ) then 'partial'
        else 'completed'
      end,
      restored_at = case
        when exists (
          select 1
          from public.offers o
          where o.status = 'trash'
            and o.metadata ->> '_bulk_reset_run_id' = r.id::text
        ) then r.restored_at
        else coalesce(r.restored_at, now())
      end
  where r.id = any(touched_runs);

  return jsonb_build_object(
    'ok', true,
    'restored_offers', affected,
    'verified_stores', coalesce(to_jsonb(p_store_slugs), 'null'::jsonb)
  );
end;
$function$;

-- Quarantine active/future offers restored from the legacy bulk reset when the
-- underlying product came from the low-confidence 0.58 parser path and neither
-- the offer nor the product was later verified.
update public.offers o
set status = 'review',
    metadata = coalesce(o.metadata, '{}'::jsonb) || jsonb_build_object(
      '_quality_quarantined_at', now(),
      '_quality_quarantine_reason', 'legacy_bulk_reset_low_confidence_058'
    ),
    updated_at = now()
from public.products p
where p.id = o.product_id
  and o.status = 'published'
  and o.valid_to >= (now() at time zone 'Europe/Prague')::date
  and o.metadata ? '_bulk_reset_recovered_from_legacy_action'
  and coalesce(o.is_verified, false) = false
  and coalesce(p.is_verified, false) = false
  and coalesce((p.metadata ->> 'source_confidence')::numeric, 0) <= 0.58;

-- Keep low-confidence parser-created products out of public product search when
-- they no longer have any active/future published offer. They remain in the DB
-- and can be reactivated after a trusted import verifies them.
update public.products p
set is_active = false,
    metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object(
      '_quality_quarantined_at', now(),
      '_quality_quarantine_reason', 'no_trusted_offer_after_legacy_cleanup'
    ),
    updated_at = now()
where coalesce(p.is_verified, false) = false
  and coalesce((p.metadata ->> 'source_confidence')::numeric, 0) <= 0.58
  and coalesce((p.metadata ->> 'created_from_leaflet_import')::boolean, false) = true
  and not exists (
    select 1
    from public.offers o
    where o.product_id = p.id
      and o.status = 'published'
      and o.valid_to >= (now() at time zone 'Europe/Prague')::date
  );
-- Retry the latest trusted Teta structured import after fixing duplicate-offer
-- handling. The old publisher stopped after its 200-row existing-offer lookup
-- and marked all remaining rows as failed.

do $block$
declare
  target_import_id uuid;
begin
  select li.id
  into target_import_id
  from public.leaflet_imports li
  join public.stores s on s.id = li.store_id
  where s.slug = 'teta'
    and li.metadata ->> 'adapter' = 'teta-campaign-html-v2'
    and coalesce(li.confidence, 0) >= 0.90
    and li.detected_valid_to >= (now() at time zone 'Europe/Prague')::date
  order by li.created_at desc
  limit 1;

  if target_import_id is null then
    return;
  end if;

  update public.leaflet_import_items
  set status = 'review',
      raw_data = coalesce(raw_data, '{}'::jsonb) - 'publish_error'
  where import_id = target_import_id
    and status = 'failed';

  update public.leaflet_imports
  set status = 'publishing',
      error_message = null,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'publisher_retry_prepared_at', now(),
        'publisher_retry_reason', 'fixed_existing_offer_lookup_over_200'
      ),
      updated_at = now()
  where id = target_import_id;
end;
$block$;
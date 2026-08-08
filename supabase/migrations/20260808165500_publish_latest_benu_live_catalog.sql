-- Promote the newest trusted BENU structured snapshot so the replacement
-- trigger can retire older overlapping live-catalog snapshots.

do $block$
declare
  target_import_id uuid;
begin
  select li.id
  into target_import_id
  from public.leaflet_imports li
  join public.stores s on s.id = li.store_id
  where s.slug = 'benu'
    and li.metadata ->> 'adapter' = 'benu-html-v1'
    and li.status = 'review'
    and coalesce(li.confidence, 0) >= 0.95
    and li.detected_valid_to >= (now() at time zone 'Europe/Prague')::date
  order by li.created_at desc
  limit 1;

  if target_import_id is null then
    return;
  end if;

  update public.leaflet_imports
  set status = 'publishing',
      error_message = null,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'publisher_retry_prepared_at', now(),
        'publisher_retry_reason', 'publish_latest_trusted_benu_live_snapshot'
      ),
      updated_at = now()
  where id = target_import_id;
end;
$block$;
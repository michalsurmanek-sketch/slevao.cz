-- Make leaflet crop generation self-driving, bounded and dependency-aware.
create or replace function public.queue_leaflet_crop_backfill(p_limit integer default 3)
returns integer
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  cron_secret text;
  queued integer := 0;
  candidate record;
begin
  p_limit := greatest(1, least(coalesce(p_limit, 3), 10));

  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name = 'slevao_cron_secret'
  limit 1;

  if coalesce(cron_secret, '') = '' then
    return 0;
  end if;

  for candidate in
    select l.id
    from public.leaflet_imports l
    where l.status in ('review', 'published')
      and (l.detected_valid_to is null or l.detected_valid_to >= current_date - 7)
      and exists (
        select 1
        from public.leaflet_import_items li
        where li.import_id = l.id
          and li.status not in ('ignored', 'rejected')
          and coalesce(nullif(li.image_url, ''), '') = ''
          and coalesce(li.raw_data #>> '{leaflet_crop,status}', '') <> 'no_safe_product_image'
          and (
            coalesce(li.raw_data->>'page_image_url', '') ~* '^https://'
            or coalesce(l.metadata->>'content_type', '') like 'image/%'
            or jsonb_typeof(l.metadata->'page_image_urls') = 'array'
            or l.source_document_url ~* '\.(?:webp|png|jpe?g)(?:\?.*)?$'
          )
      )
      and (
        coalesce(l.metadata->>'crop_status', '') in ('', 'queued')
        or (
          l.metadata->>'crop_status' = 'running'
          and coalesce((l.metadata->>'crop_started_at')::timestamptz, 'epoch') < now() - interval '15 minutes'
        )
        or (
          l.metadata->>'crop_status' = 'failed'
          and coalesce((l.metadata->>'crop_finished_at')::timestamptz, 'epoch') < now() - interval '6 hours'
        )
        or (
          l.metadata->>'crop_status' = 'blocked_dependency'
          and coalesce((l.metadata->>'crop_next_retry_at')::timestamptz, now()) <= now()
        )
      )
    order by
      case when l.status = 'published' then 0 else 1 end,
      l.detected_valid_to desc nulls last,
      l.created_at desc
    limit p_limit
    for update skip locked
  loop
    update public.leaflet_imports
    set metadata = jsonb_set(
      jsonb_set(coalesce(metadata, '{}'::jsonb), '{crop_status}', '"queued"'::jsonb, true),
      '{crop_queued_at}', to_jsonb(now()), true
    )
    where id = candidate.id;

    perform net.http_post(
      url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/generate-leaflet-product-crops',
      headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', cron_secret),
      body := jsonb_build_object('import_id', candidate.id),
      timeout_milliseconds := 5000
    );
    queued := queued + 1;
  end loop;

  return queued;
end;
$$;

revoke all on function public.queue_leaflet_crop_backfill(integer) from public;
grant execute on function public.queue_leaflet_crop_backfill(integer) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'leaflet-crop-backfill') then
    perform cron.unschedule('leaflet-crop-backfill');
  end if;
end;
$$;

select cron.schedule(
  'leaflet-crop-backfill',
  '*/10 * * * *',
  $job$select public.queue_leaflet_crop_backfill(3);$job$
);

-- Pick up already-published imports produced before item-level page rasters were
-- understood by the queue. The function itself performs the external call.
update public.leaflet_imports l
set metadata = jsonb_set(coalesce(l.metadata, '{}'::jsonb), '{crop_status}', '"queued"'::jsonb, true)
where l.status in ('review', 'published')
  and (l.detected_valid_to is null or l.detected_valid_to >= current_date - 7)
  and exists (
    select 1 from public.leaflet_import_items li
    where li.import_id = l.id
      and li.status not in ('ignored', 'rejected')
      and coalesce(nullif(li.image_url, ''), '') = ''
      and coalesce(li.raw_data->>'page_image_url', '') ~* '^https://'
  );

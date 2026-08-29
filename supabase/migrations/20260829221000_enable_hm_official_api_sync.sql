-- Switch H&M from the blocked storefront page to the official public catalog API.
update public.leaflet_sources
set source_url = 'https://api.hm.com/search-services/v1/cs_cz/listing/resultpage',
    source_type = 'api',
    is_active = true,
    auto_publish = true,
    check_interval_minutes = 120,
    automation_mode = 'automatic',
    adapter_key = 'hm-official-api-sale-v1',
    extraction_strategy = 'structured_api',
    disabled_reason = null,
    next_review_at = null,
    last_error = null,
    updated_at = now()
where store_id = (select id from public.stores where slug = 'hm' limit 1)
  and name = 'H&M – oficiální výprodej';

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'slevao-hm-products'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'slevao-hm-products',
    '19 */2 * * *',
    $cron$select private.invoke_edge_function('sync-hm-products', jsonb_build_object('dry_run', false), 120000);$cron$
  );
end
$$;

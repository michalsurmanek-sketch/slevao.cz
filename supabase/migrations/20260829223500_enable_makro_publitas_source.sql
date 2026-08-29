update public.leaflet_sources
set source_url = 'https://api.publitas.com/v1/groups/makro-letaky-a-katalogy/publications.json',
    source_type = 'api',
    is_active = true,
    auto_publish = true,
    check_interval_minutes = 60,
    automation_mode = 'automatic',
    adapter_key = 'makro-publitas-source-v1',
    extraction_strategy = 'structured_publitas',
    disabled_reason = null,
    next_review_at = null,
    last_error = null,
    updated_at = now()
where store_id = (select id from public.stores where slug = 'makro' limit 1)
  and name = 'MAKRO – aktuální nabídky';

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='slevao-makro-source' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule(
    'slevao-makro-source',
    '37 * * * *',
    $cron$select private.invoke_edge_function('sync-makro-source','{}'::jsonb,120000);$cron$
  );
end
$$;

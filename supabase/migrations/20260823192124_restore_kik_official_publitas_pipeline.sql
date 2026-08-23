do $$
declare
  v_store_id uuid;
  v_jobid bigint;
begin
  select id into v_store_id from public.stores where slug='kik' limit 1;
  if v_store_id is null then
    raise exception 'KiK store not found';
  end if;

  update public.leaflet_sources
  set is_active = (source_url = 'https://www.kik.cz/tvuj-online-letak'),
      auto_publish = (source_url = 'https://www.kik.cz/tvuj-online-letak'),
      check_interval_minutes = case when source_url = 'https://www.kik.cz/tvuj-online-letak' then 15 else check_interval_minutes end,
      adapter_key = case when source_url = 'https://www.kik.cz/tvuj-online-letak' then 'kik-publitas-v2' else adapter_key end,
      extraction_strategy = case when source_url = 'https://www.kik.cz/tvuj-online-letak' then 'official_publitas_viewer' else extraction_strategy end,
      disabled_reason = case when source_url = 'https://www.kik.cz/tvuj-online-letak' then null else disabled_reason end,
      updated_at = now()
  where store_id = v_store_id;

  select jobid into v_jobid from cron.job where jobname='slevao-kik-source' limit 1;
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;

  select jobid into v_jobid from cron.job where jobname='slevao-kik-products' limit 1;
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;

  perform cron.schedule(
    'slevao-kik-source',
    '8,23,38,53 * * * *',
    $cron$select private.invoke_edge_function('sync-kik-source','{}'::jsonb,120000);$cron$
  );

  perform cron.schedule(
    'slevao-kik-products',
    '11,26,41,56 * * * *',
    $cron$select private.invoke_edge_function('sync-kik-products',jsonb_build_object('dry_run',false,'force',false),120000);$cron$
  );
end;
$$;

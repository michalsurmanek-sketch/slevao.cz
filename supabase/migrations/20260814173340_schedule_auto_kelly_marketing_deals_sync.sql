do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname='sync-auto-kelly-marketing-deals';
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
  perform cron.schedule(
    'sync-auto-kelly-marketing-deals',
    '47 4 * * *',
    $cron$select private.invoke_edge_function('sync-auto-kelly-products','{}'::jsonb,120000);$cron$
  );
end $$;

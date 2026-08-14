do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='sync-penny-official-images';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'sync-penny-official-images',
    '25 * * * *',
    $cmd$select private.invoke_edge_function('sync-penny-images','{}'::jsonb,120000);$cmd$
  );
end $$;

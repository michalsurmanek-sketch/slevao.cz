do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname='sync-dr-max-official-source';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'sync-dr-max-official-source',
    '18 */6 * * *',
    $cron$select private.invoke_edge_function('sync-dr-max-source','{}'::jsonb,120000);$cron$
  );
end $$;

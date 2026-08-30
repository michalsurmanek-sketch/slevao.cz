do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='cleanup-cron-job-history';
  if v_job is not null then perform cron.unschedule(v_job); end if;

  perform cron.schedule(
    'cleanup-cron-job-history',
    '47 3 * * *',
    $cron$delete from cron.job_run_details where start_time < now() - interval '30 days';$cron$
  );
end $$;

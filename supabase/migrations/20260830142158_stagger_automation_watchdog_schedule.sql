do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='slevao-automation-watchdog';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'slevao-automation-watchdog',
    '6,16,26,36,46,56 * * * *',
    $cron$select private.run_automation_watchdog();$cron$
  );
end $$;

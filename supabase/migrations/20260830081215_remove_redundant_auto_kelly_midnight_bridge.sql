do $$
declare v_job bigint;
begin
  select jobid into v_job
  from cron.job
  where jobname='sync-auto-kelly-midnight-bridge';

  if v_job is not null then
    perform cron.unschedule(v_job);
  end if;
end $$;
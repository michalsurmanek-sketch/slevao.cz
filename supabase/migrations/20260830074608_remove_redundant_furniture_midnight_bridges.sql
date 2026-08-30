do $$
declare
  v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='xxxlutz-midnight-bridge';
  if v_job is not null then perform cron.unschedule(v_job); end if;

  select jobid into v_job from cron.job where jobname='moebelix-midnight-bridge';
  if v_job is not null then perform cron.unschedule(v_job); end if;
end $$;

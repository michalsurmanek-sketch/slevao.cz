do $$
declare
  v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='xxxlutz-midnight-bridge';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'xxxlutz-midnight-bridge',
    '0 22,23 * * *',
    $cron$
      select case
        when extract(hour from (now() at time zone 'Europe/Prague')) = 0
          then public.trigger_xxxlutz_verified_sync()
        else null::bigint
      end;
    $cron$
  );

  select jobid into v_job from cron.job where jobname='moebelix-midnight-bridge';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'moebelix-midnight-bridge',
    '1 22,23 * * *',
    $cron$
      select case
        when extract(hour from (now() at time zone 'Europe/Prague')) = 0
          then public.trigger_moebelix_verified_sync()
        else null::bigint
      end;
    $cron$
  );
end $$;

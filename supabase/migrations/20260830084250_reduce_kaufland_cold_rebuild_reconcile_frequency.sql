do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='slevao-reconcile-kaufland-cold-rebuilds';
  if v_job is null then
    raise exception 'Cron slevao-reconcile-kaufland-cold-rebuilds nebyl nalezen.';
  end if;
  perform cron.alter_job(job_id := v_job, schedule := '*/5 * * * *');
end $$;

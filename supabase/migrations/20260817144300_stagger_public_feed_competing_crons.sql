do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname='reconcile-penny-structured-products';
  if v_jobid is not null then perform cron.alter_job(job_id := v_jobid, schedule := '1-59/5 * * * *'); end if;

  select jobid into v_jobid from cron.job where jobname='reconcile-flop-top-verified-products';
  if v_jobid is not null then perform cron.alter_job(job_id := v_jobid, schedule := '1-59/5 * * * *'); end if;

  select jobid into v_jobid from cron.job where jobname='reconcile-lidl-verified-products';
  if v_jobid is not null then perform cron.alter_job(job_id := v_jobid, schedule := '2-59/5 * * * *'); end if;

  select jobid into v_jobid from cron.job where jobname='reconcile-coop-verified-products';
  if v_jobid is not null then perform cron.alter_job(job_id := v_jobid, schedule := '3-59/5 * * * *'); end if;

  select jobid into v_jobid from cron.job where jobname='reconcile-billa-verified-products';
  if v_jobid is not null then perform cron.alter_job(job_id := v_jobid, schedule := '4-59/5 * * * *'); end if;

  select jobid into v_jobid from cron.job where jobname='reconcile-dm-rossmann-overlaps';
  if v_jobid is not null then perform cron.alter_job(job_id := v_jobid, schedule := '4-59/5 * * * *'); end if;
end
$$;

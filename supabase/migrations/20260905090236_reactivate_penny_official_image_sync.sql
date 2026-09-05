do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname='sync-penny-official-images';
  if v_job_id is not null then
    perform cron.alter_job(job_id := v_job_id, active := true);
  end if;
end $$;

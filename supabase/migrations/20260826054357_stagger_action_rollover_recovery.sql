do $migration$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname='sync-action-offers-publish'
  order by jobid
  limit 1;

  if v_job_id is null then
    raise exception 'sync-action-offers-publish cron job not found';
  end if;

  perform cron.alter_job(
    job_id := v_job_id,
    schedule := '2,17,32,47 * * * *'
  );
end;
$migration$;

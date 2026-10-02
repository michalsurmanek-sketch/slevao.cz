do $migration$
declare
  v_job_id bigint;
  v_found boolean := false;
  v_command constant text := 'select private.refresh_public_offer_search_cache_if_dirty(false);';
begin
  for v_job_id in
    select jobid
    from cron.job
    where jobname = 'refresh-public-offer-search-cache'
    order by jobid
  loop
    v_found := true;
    perform cron.alter_job(
      job_id := v_job_id,
      schedule := '*/5 * * * *',
      command := v_command
    );
  end loop;

  if not v_found then
    perform cron.schedule(
      'refresh-public-offer-search-cache',
      '*/5 * * * *',
      v_command
    );
  end if;

  if not exists (
    select 1
    from cron.job
    where jobname = 'refresh-public-offer-search-cache'
      and schedule = '*/5 * * * *'
      and command = v_command
      and active
  ) then
    raise exception 'Public offer search cache cron job was not scheduled every five minutes';
  end if;

  if exists (
    select 1
    from cron.job
    where jobname = 'refresh-public-offer-search-cache'
      and (schedule is distinct from '*/5 * * * *' or command is distinct from v_command)
  ) then
    raise exception 'A duplicate public offer search cache cron job still has the wrong schedule or command';
  end if;
end
$migration$;

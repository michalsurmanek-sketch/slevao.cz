-- A worker can disappear after creating an audit row. Even though the duplicate-
-- signature bug is fixed, keep the health table self-healing after network/runtime
-- interruptions by closing stale `running` rows.

create or replace function public.cleanup_stale_kaufland_product_sync_audits(
  p_age interval default interval '30 minutes'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.kaufland_product_sync_audit
  set status = 'failed',
      error_message = coalesce(
        error_message,
        'Synchronizační audit byl automaticky uzavřen po překročení maximální doby běhu.'
      )
  where status = 'running'
    and run_at < now() - greatest(p_age, interval '10 minutes');

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.cleanup_stale_kaufland_product_sync_audits(interval)
  from public, anon, authenticated;
grant execute on function public.cleanup_stale_kaufland_product_sync_audits(interval)
  to service_role;

-- Clean historical leftovers immediately.
select public.cleanup_stale_kaufland_product_sync_audits(interval '10 minutes');

-- Keep one watchdog job even if this migration is re-applied in a recovery environment.
do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'cleanup-stale-kaufland-product-sync-audits'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end
$$;

select cron.schedule(
  'cleanup-stale-kaufland-product-sync-audits',
  '*/15 * * * *',
  $$select public.cleanup_stale_kaufland_product_sync_audits(interval '30 minutes');$$
);

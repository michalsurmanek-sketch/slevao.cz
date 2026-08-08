create or replace function public.trigger_hruska_verified_sync()
returns bigint
language sql
security definer
set search_path = public, private, pg_temp
as $$
  select private.invoke_edge_function(
    'sync-hruska-source',
    '{}'::jsonb,
    120000
  );
$$;

revoke all on function public.trigger_hruska_verified_sync() from public, anon, authenticated;
grant execute on function public.trigger_hruska_verified_sync() to service_role;

comment on function public.trigger_hruska_verified_sync() is
  'Queues the complete Hruška verified PDF -> coordinates -> unit-price validation -> publish pipeline.';

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job
  where jobname = 'sync-hruska-verified-products'
  limit 1;

  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  perform cron.schedule(
    'sync-hruska-verified-products',
    '47 */6 * * *',
    'select public.trigger_hruska_verified_sync();'
  );
end;
$$;

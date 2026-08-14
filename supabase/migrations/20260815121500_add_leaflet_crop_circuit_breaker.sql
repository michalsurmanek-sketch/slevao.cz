-- A single provider outage must not fan out into one failing request per import.
create or replace function public.queue_leaflet_crop_backfill_guarded(p_limit integer default 3)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.leaflet_imports l
    where l.metadata->>'crop_status' = 'blocked_dependency'
      and coalesce((l.metadata->>'crop_next_retry_at')::timestamptz, now()) > now()
  ) then
    return 0;
  end if;

  return public.queue_leaflet_crop_backfill(p_limit);
end;
$$;

revoke all on function public.queue_leaflet_crop_backfill_guarded(integer) from public;
grant execute on function public.queue_leaflet_crop_backfill_guarded(integer) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'leaflet-crop-backfill') then
    perform cron.unschedule('leaflet-crop-backfill');
  end if;
end;
$$;

select cron.schedule(
  'leaflet-crop-backfill',
  '*/10 * * * *',
  $job$select public.queue_leaflet_crop_backfill_guarded(3);$job$
);

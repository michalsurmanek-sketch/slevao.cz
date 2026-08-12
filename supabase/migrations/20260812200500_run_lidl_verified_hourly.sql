-- Ensure Lidl's verified parser picks up a preloaded next leaflet immediately
-- after the Europe/Prague validity date changes.
do $do$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'sync-lidl-verified-products'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end
$do$;

select cron.schedule(
  'sync-lidl-verified-products',
  '5 * * * *',
  $cron$select public.trigger_lidl_verified_sync();$cron$
);

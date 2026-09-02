do $do$
declare r record;
begin
  for r in select jobid from cron.job where jobname in ('sync-benu-verified-products','sync-benu-midnight-bridge') loop
    perform cron.unschedule(r.jobid);
  end loop;
end
$do$;

select cron.schedule(
  'sync-benu-verified-products',
  '35 */3 * * *',
  $cron$select private.invoke_edge_function('sync-benu-source','{}'::jsonb,120000);$cron$
);

do $do$
declare r record;
begin
  for r in select jobid from cron.job where jobname='classify-catalog-family-consensus-v74' loop
    perform cron.unschedule(r.jobid);
  end loop;
  perform cron.schedule(
    'classify-catalog-family-consensus-v74',
    '32 * * * *',
    $cmd$select private.refresh_catalog_family_consensus_v74();$cmd$
  );
end;
$do$;

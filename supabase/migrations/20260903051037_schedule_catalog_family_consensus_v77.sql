do $do$
declare r record;
begin
  for r in select jobid from cron.job where jobname in ('classify-catalog-family-consensus-v74','classify-catalog-family-consensus-v76') loop
    perform cron.unschedule(r.jobid);
  end loop;
  perform cron.schedule(
    'classify-catalog-family-consensus-v76',
    '32 * * * *',
    $cmd$select private.refresh_catalog_family_consensus_v76();$cmd$
  );
end;
$do$;

do $do$
declare r record;
begin
  for r in select jobid from cron.job where jobname='classify-catalog-token-consensus-v70' loop
    perform cron.unschedule(r.jobid);
  end loop;
  perform cron.schedule(
    'classify-catalog-token-consensus-v70',
    '27 * * * *',
    $cmd$select private.refresh_catalog_token_consensus_v70();$cmd$
  );
end;
$do$;

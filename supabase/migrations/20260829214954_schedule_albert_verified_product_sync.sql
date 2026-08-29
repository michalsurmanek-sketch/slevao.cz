do $$
declare
  v_job record;
begin
  for v_job in
    select jobid from cron.job where jobname in ('slevao-albert-products','sync-albert-products','sync-albert-verified-products')
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'slevao-albert-products',
  '24 * * * *',
  $job$select private.invoke_edge_function('sync-albert-products', '{}'::jsonb, 120000);$job$
);

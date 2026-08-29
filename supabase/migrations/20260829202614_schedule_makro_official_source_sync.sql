do $$
declare r record;
begin
  for r in select jobid from cron.job where jobname = 'slevao-makro-source'
  loop
    perform cron.unschedule(r.jobid);
  end loop;
end $$;

select cron.schedule(
  'slevao-makro-source',
  '27 * * * *',
  $job$select private.invoke_edge_function('sync-makro-source', '{}'::jsonb, 120000);$job$
);

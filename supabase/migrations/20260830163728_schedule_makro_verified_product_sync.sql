do $$
begin
  if exists (select 1 from cron.job where jobname = 'slevao-makro-products') then
    perform cron.unschedule('slevao-makro-products');
  end if;
end $$;

select cron.schedule(
  'slevao-makro-products',
  '35 * * * *',
  $$select private.invoke_edge_function('sync-makro-products', '{}'::jsonb, 120000);$$
);

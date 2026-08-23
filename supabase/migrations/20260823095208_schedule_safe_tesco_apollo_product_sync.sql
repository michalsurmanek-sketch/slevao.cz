select cron.schedule(
  'slevao-sync-tesco-safe-products',
  '17 */3 * * *',
  $$select private.invoke_edge_function('sync-tesco-apollo-products','{"dry_run":false}'::jsonb,120000);$$
);

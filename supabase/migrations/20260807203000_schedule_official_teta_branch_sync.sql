select cron.schedule(
  'sync-teta-branches',
  '40 4 * * 0',
  $$select public.invoke_teta_branch_sync(false);$$
);

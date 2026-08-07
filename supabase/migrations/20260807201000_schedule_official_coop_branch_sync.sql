select cron.schedule(
  'sync-coop-branches',
  '55 3 * * 0',
  $$select public.invoke_coop_branch_sync(false);$$
);

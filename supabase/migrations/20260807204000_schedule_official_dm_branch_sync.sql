select cron.schedule(
  'sync-dm-branches',
  '45 4 * * 0',
  $$select public.invoke_dm_branch_sync(false);$$
);

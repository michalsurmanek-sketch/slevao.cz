select cron.schedule(
  'sync-globus-branches',
  '45 3 * * 0',
  $$select public.invoke_globus_branch_sync(false);$$
);
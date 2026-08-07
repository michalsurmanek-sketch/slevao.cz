select cron.schedule(
  'sync-jip-branches',
  '50 3 * * 0',
  $$select public.invoke_jip_branch_sync(false);$$
);

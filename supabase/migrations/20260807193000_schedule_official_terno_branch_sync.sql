select cron.schedule(
  'sync-terno-branches',
  '40 3 * * 0',
  $$select public.invoke_terno_branch_sync(false);$$
);
select cron.schedule(
  'sync-albert-branches',
  '45 2 * * 0',
  $$select public.invoke_store_branch_sync('albert_official', false);$$
);

select cron.schedule(
  'sync-billa-branches',
  '50 2 * * 0',
  $$select public.invoke_store_branch_sync('billa_official', false);$$
);
select cron.schedule(
  'fetch-pepco-branches',
  '0 5 * * 0',
  $$select public.request_pepco_branch_source();$$
);

select cron.schedule(
  'apply-pepco-branches',
  '5 5 * * 0',
  $$select public.apply_latest_pepco_branch_source(false);$$
);

select cron.schedule(
  'fetch-rossmann-branches',
  '50 4 * * 0',
  $$select public.request_rossmann_branch_source();$$
);

select cron.schedule(
  'apply-rossmann-branches',
  '55 4 * * 0',
  $$select public.apply_latest_rossmann_branch_source(false);$$
);

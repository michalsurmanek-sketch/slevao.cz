select cron.schedule(
  'fetch-kik-branches',
  '10 5 * * 0',
  $$select public.request_kik_branch_source();$$
);

select cron.schedule(
  'apply-kik-branches',
  '15 5 * * 0',
  $$select public.apply_latest_kik_branch_source(false);$$
);

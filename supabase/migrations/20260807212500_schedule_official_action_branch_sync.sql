select cron.schedule(
  'fetch-action-sitemap',
  '20 5 * * 0',
  $$select public.request_action_sitemap_source();$$
);

select cron.schedule(
  'queue-action-branches',
  '25 5 * * 0',
  $$select public.queue_latest_action_branch_details();$$
);

select cron.schedule(
  'apply-action-branches',
  '35 5 * * 0',
  $$select public.apply_latest_action_branch_details(false);$$
);

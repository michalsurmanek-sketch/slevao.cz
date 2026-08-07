select cron.schedule(
  'sync-tesco-branches-000',
  '0 4 * * 0',
  $$select public.invoke_tesco_branch_sync(0,25,false);$$
);

select cron.schedule(
  'sync-tesco-branches-025',
  '5 4 * * 0',
  $$select public.invoke_tesco_branch_sync(25,25,false);$$
);

select cron.schedule(
  'sync-tesco-branches-050',
  '10 4 * * 0',
  $$select public.invoke_tesco_branch_sync(50,25,false);$$
);

select cron.schedule(
  'sync-tesco-branches-075',
  '15 4 * * 0',
  $$select public.invoke_tesco_branch_sync(75,25,false);$$
);

select cron.schedule(
  'sync-tesco-branches-100',
  '20 4 * * 0',
  $$select public.invoke_tesco_branch_sync(100,25,false);$$
);

select cron.schedule(
  'sync-tesco-branches-125',
  '25 4 * * 0',
  $$select public.invoke_tesco_branch_sync(125,25,false);$$
);

select cron.schedule(
  'sync-tesco-branches-150',
  '30 4 * * 0',
  $$select public.invoke_tesco_branch_sync(150,25,false);$$
);

select cron.schedule(
  'sync-tesco-branches-175',
  '35 4 * * 0',
  $$select public.invoke_tesco_branch_sync(175,25,false);$$
);

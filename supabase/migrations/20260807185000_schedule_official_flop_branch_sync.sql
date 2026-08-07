select cron.schedule('sync-flop-branches-000','0 3 * * 0',$$select public.invoke_store_branch_sync('flop_official', false, 0, 20);$$);
select cron.schedule('sync-flop-branches-020','5 3 * * 0',$$select public.invoke_store_branch_sync('flop_official', false, 20, 20);$$);
select cron.schedule('sync-flop-branches-040','10 3 * * 0',$$select public.invoke_store_branch_sync('flop_official', false, 40, 20);$$);
select cron.schedule('sync-flop-branches-060','15 3 * * 0',$$select public.invoke_store_branch_sync('flop_official', false, 60, 20);$$);
select cron.schedule('sync-flop-branches-080','20 3 * * 0',$$select public.invoke_store_branch_sync('flop_official', false, 80, 20);$$);
select cron.schedule('sync-flop-branches-100','25 3 * * 0',$$select public.invoke_store_branch_sync('flop_official', false, 100, 20);$$);
select cron.schedule('sync-flop-branches-120','30 3 * * 0',$$select public.invoke_store_branch_sync('flop_official', false, 120, 20);$$);
select cron.schedule('sync-flop-branches-140','35 3 * * 0',$$select public.invoke_store_branch_sync('flop_official', false, 140, 20);$$);
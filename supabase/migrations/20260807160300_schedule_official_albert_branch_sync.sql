-- Weekly refresh of official Albert branch coordinates from albert.cz GraphQL.
-- Idempotent: a later local migration replay replaces the same named cron job.
-- Secret stays in Supabase Vault and is never exposed to browser clients.

do $$
declare
  branch_count integer;
  gps_missing integer;
  unique_count integer;
  existing_job bigint;
begin
  select count(*)::int,
         count(*) filter (where b.latitude is null or b.longitude is null)::int,
         count(distinct b.external_id)::int
    into branch_count, gps_missing, unique_count
  from public.branches b
  join public.stores s on s.id=b.store_id
  where s.slug='albert';

  if branch_count < 330 or gps_missing <> 0 or unique_count <> branch_count then
    raise exception 'Albert branch integrity failed: count %, missing_gps %, unique %', branch_count, gps_missing, unique_count;
  end if;

  select jobid into existing_job from cron.job where jobname='sync-albert-branches' limit 1;
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
end $$;

select cron.schedule(
  'sync-albert-branches',
  '45 2 * * 0',
  $$select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-store-branches',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='slevao_cron_secret' limit 1)
    ),
    body := '{"dry_run":false,"source":"albert_official"}'::jsonb,
    timeout_milliseconds := 60000
  ) as request_id;$$
);

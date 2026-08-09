create or replace function public.invoke_action_source_sync()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, pg_catalog
as $$
declare
  v_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'slevao_cron_secret'
  limit 1;

  if nullif(v_secret, '') is null then
    raise exception 'slevao_cron_secret is missing from Vault';
  end if;

  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-action-source',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{"dry_run":false}'::jsonb,
    timeout_milliseconds := 60000
  ) into v_request_id;

  return v_request_id;
end;
$$;

create or replace function public.invoke_action_products_sync()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, pg_catalog
as $$
declare
  v_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'slevao_cron_secret'
  limit 1;

  if nullif(v_secret, '') is null then
    raise exception 'slevao_cron_secret is missing from Vault';
  end if;

  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-action-products',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{"dry_run":false}'::jsonb,
    timeout_milliseconds := 60000
  ) into v_request_id;

  return v_request_id;
end;
$$;

do $$
declare
  v_job record;
begin
  for v_job in
    select jobid from cron.job
    where jobname in ('sync-action-offers-source', 'sync-action-offers-publish')
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'sync-action-offers-source',
  '10 3 * * *',
  'select public.invoke_action_source_sync();'
);

select cron.schedule(
  'sync-action-offers-publish',
  '25 3 * * *',
  'select public.invoke_action_products_sync();'
);

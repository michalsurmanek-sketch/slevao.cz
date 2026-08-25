create or replace function public.invoke_action_products_sync()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, pg_catalog
as $$
declare
  v_secret text;
  v_request_id bigint;
  v_store_id uuid;
  v_current_count integer := 0;
  v_today date := (now() at time zone 'Europe/Prague')::date;
begin
  select id into v_store_id from public.stores where slug='action' limit 1;
  if v_store_id is null then
    return null;
  end if;

  select count(*) into v_current_count
  from public.offers
  where store_id=v_store_id
    and status='published'
    and valid_from<=v_today
    and valid_to>=v_today
    and metadata->>'adapter'='action-official-html-v2';

  if v_current_count>=20 then
    return null;
  end if;

  if not exists (
    select 1
    from public.leaflet_imports li
    where li.store_id=v_store_id
      and li.metadata->>'adapter'='action-html-v3'
      and li.detected_valid_from<=v_today
      and li.detected_valid_to>=v_today
      and li.product_count>=20
      and li.status in ('review','published')
  ) then
    return null;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name='slevao_cron_secret'
  order by created_at desc
  limit 1;

  if nullif(v_secret,'') is null then
    raise exception 'slevao_cron_secret is missing from Vault';
  end if;

  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-action-products',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',v_secret),
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
  for v_job in select jobid from cron.job where jobname='sync-action-offers-publish'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'sync-action-offers-publish',
  '*/15 * * * *',
  'select public.invoke_action_products_sync();'
);

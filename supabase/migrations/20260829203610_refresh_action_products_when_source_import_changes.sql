create or replace function public.invoke_action_products_sync()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'vault', 'net', 'pg_catalog'
as $function$
declare
  v_secret text;
  v_request_id bigint;
  v_store_id uuid;
  v_latest_import_id uuid;
  v_current_latest_count integer := 0;
  v_today date := (now() at time zone 'Europe/Prague')::date;
begin
  select id into v_store_id
  from public.stores
  where slug='action'
  limit 1;

  if v_store_id is null then
    return null;
  end if;

  select li.id into v_latest_import_id
  from public.leaflet_imports li
  where li.store_id=v_store_id
    and li.metadata->>'adapter'='action-html-v3'
    and li.detected_valid_from<=v_today
    and li.detected_valid_to>=v_today
    and li.product_count>=20
    and li.status in ('review','published')
  order by li.created_at desc
  limit 1;

  if v_latest_import_id is null then
    return null;
  end if;

  select count(*) into v_current_latest_count
  from public.offers
  where store_id=v_store_id
    and status='published'
    and valid_from<=v_today
    and valid_to>=v_today
    and metadata->>'adapter'='action-official-html-v2'
    and metadata->>'source_import_id'=v_latest_import_id::text;

  if v_current_latest_count>=20 then
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
$function$;

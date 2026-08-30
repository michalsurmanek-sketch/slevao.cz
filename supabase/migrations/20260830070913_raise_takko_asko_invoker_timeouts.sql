create or replace function public.invoke_takko_products_sync()
returns bigint
language plpgsql
security definer
set search_path to 'public','vault','net'
as $function$
declare cron_secret text; request_id bigint;
begin
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name='slevao_cron_secret' limit 1;
  if cron_secret is null or cron_secret='' then raise exception 'Missing vault secret slevao_cron_secret'; end if;
  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-takko-products',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',cron_secret),
    body := '{"dry_run":false}'::jsonb,
    timeout_milliseconds := 120000
  ) into request_id;
  return request_id;
end;
$function$;

create or replace function public.invoke_asko_products_sync()
returns bigint
language plpgsql
security definer
set search_path to 'public','vault','net'
as $function$
declare cron_secret text; request_id bigint;
begin
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name='slevao_cron_secret' limit 1;
  if cron_secret is null or cron_secret='' then raise exception 'Missing vault secret slevao_cron_secret'; end if;
  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-asko-products',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',cron_secret),
    body := '{"dry_run":false}'::jsonb,
    timeout_milliseconds := 120000
  ) into request_id;
  return request_id;
end;
$function$;

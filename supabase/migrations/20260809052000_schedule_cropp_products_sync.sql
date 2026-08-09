create or replace function public.invoke_cropp_products_sync()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare cron_secret text; request_id bigint;
begin
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name='slevao_cron_secret' limit 1;
  if cron_secret is null or cron_secret='' then raise exception 'Missing vault secret slevao_cron_secret'; end if;
  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-cropp-products',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',cron_secret),
    body := '{"dry_run":false}'::jsonb,
    timeout_milliseconds := 60000
  ) into request_id;
  return request_id;
end;
$$;

revoke all on function public.invoke_cropp_products_sync() from public, anon, authenticated;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='sync-cropp-verified-products' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule('sync-cropp-verified-products','20 5 * * *','select public.invoke_cropp_products_sync();');
end;
$$;

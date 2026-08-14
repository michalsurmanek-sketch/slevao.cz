insert into public.leaflet_sources(
  store_id,name,source_url,source_type,is_active,auto_publish,check_interval_minutes,
  coverage_scope,automation_mode,adapter_key,extraction_strategy,manual_fallback_enabled
)
select
  s.id,
  'Košík.cz – akční API',
  'https://www.kosik.cz/s1-akce',
  'api',
  true,
  false,
  360,
  'national',
  'automatic',
  'kosik-official-flexible-cursor-v1',
  'api',
  true
from public.stores s
where s.slug='kosik'
and not exists(
  select 1 from public.leaflet_sources ls
  where ls.store_id=s.id and ls.source_url='https://www.kosik.cz/s1-akce'
);

create or replace function public.invoke_kosik_products_sync()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  cron_secret text;
  request_id bigint;
begin
  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name = 'slevao_cron_secret'
  limit 1;

  if cron_secret is null or cron_secret = '' then
    raise exception 'Missing vault secret slevao_cron_secret';
  end if;

  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-kosik-products',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', cron_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.invoke_kosik_products_sync() from public, anon, authenticated;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='sync-kosik-verified-products' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule('sync-kosik-verified-products','17 */6 * * *','select public.invoke_kosik_products_sync();');
end;
$$;

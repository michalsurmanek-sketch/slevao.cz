-- Keep live snapshot stores fresh across date boundaries and make TEDi request queue reusable.

create or replace function public.request_tedi_home()
returns bigint
language plpgsql
set search_path to 'public','private','net','pg_temp'
as $function$
declare v_id bigint;
begin
  select net.http_get(
    url := 'https://www.tedi.com/cz/',
    headers := jsonb_build_object('user-agent','Mozilla/5.0','accept','text/html','accept-language','cs-CZ,cs;q=0.9'),
    timeout_milliseconds := 120000
  ) into v_id;
  insert into private.store_sync_http_queue(store_slug,phase,request_id,source_url,created_at)
  values('tedi','home',v_id,'https://www.tedi.com/cz/',now())
  on conflict(store_slug,phase) do update
    set request_id=excluded.request_id,
        source_url=excluded.source_url,
        created_at=excluded.created_at;
  return v_id;
end;
$function$;

do $$
declare r record;
begin
  for r in select jobid from cron.job where jobname in (
    'sync_rohlik_price_hits_request_daily',
    'sync_rohlik_price_hits_apply_daily',
    'sync-rohlik-price-hits-v2-6h',
    'sync-dek-products-6h',
    'sync-benu-midnight-bridge',
    'sync-auto-kelly-midnight-bridge'
  ) loop
    perform cron.unschedule(r.jobid);
  end loop;
end $$;

select cron.schedule(
  'sync-rohlik-price-hits-v2-6h',
  '20 */6 * * *',
  $$select private.invoke_edge_function('sync-rohlik-price-hits-v2','{}'::jsonb,120000);$$
);

select cron.schedule(
  'sync-dek-products-6h',
  '25 */6 * * *',
  $$select private.invoke_edge_function('sync-dek-products','{}'::jsonb,120000);$$
);

-- Europe/Prague midnight bridge: one of 22:10/23:10 UTC lands at 00:10 local across DST seasons.
select cron.schedule(
  'sync-benu-midnight-bridge',
  '10 22,23 * * *',
  $$select net.http_post(
    url:='https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-benu-source',
    headers:=jsonb_build_object(
      'content-type','application/json',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='slevao_cron_secret' limit 1)
    ),
    body:='{}'::jsonb,
    timeout_milliseconds:=30000
  );$$
);

select cron.schedule(
  'sync-auto-kelly-midnight-bridge',
  '15 22,23 * * *',
  $$select private.invoke_edge_function('sync-auto-kelly-products','{}'::jsonb,120000);$$
);

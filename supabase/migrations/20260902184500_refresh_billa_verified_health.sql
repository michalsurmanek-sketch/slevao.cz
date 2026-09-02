create or replace function public.refresh_billa_verified_health()
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $fn$
declare
  v_store_id uuid;
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_offer_count integer := 0;
  v_import public.leaflet_imports%rowtype;
  v_parser text;
begin
  select id into v_store_id from public.stores where slug='billa' limit 1;
  if v_store_id is null then return jsonb_build_object('ok',false,'error','BILLA store not found'); end if;

  select li.* into v_import
  from public.leaflet_imports li
  where li.store_id=v_store_id
    and li.status='published'
    and li.metadata->>'adapter'='store:billa-coordinate-pdf'
    and li.detected_valid_from<=v_today
    and li.detected_valid_to>=v_today
    and li.product_count>0
  order by li.updated_at desc
  limit 1;

  select count(*) into v_offer_count
  from public.offers
  where store_id=v_store_id
    and status='published'
    and valid_from<=v_today
    and valid_to>=v_today;

  if v_import.id is not null and v_offer_count>0 then
    v_parser := coalesce(v_import.metadata->>'parser','billa-coordinate-v3');
    update public.store_product_sync_state
       set last_run_at=now(),
           last_success_at=v_import.updated_at,
           last_offer_count=v_offer_count,
           last_published_count=v_offer_count,
           last_valid_from=v_import.detected_valid_from,
           last_valid_to=v_import.detected_valid_to,
           last_import_id=v_import.id,
           last_error=null,
           last_parser_error=null,
           parser_version=v_parser,
           adapter_name=v_parser,
           adapter_version=v_parser,
           health_status='ok',
           health_reason=format('BILLA: %s aktuálních publikovaných nabídek z ověřeného coordinate PDF pipeline.',v_offer_count),
           updated_at=now()
     where store_id=v_store_id;
  else
    update public.store_product_sync_state
       set last_run_at=now(),
           health_status='waiting_source',
           health_reason=format('BILLA: pro %s zatím není publikovaný aktuální ověřený coordinate import.',v_today),
           last_offer_count=0,
           last_published_count=0,
           updated_at=now()
     where store_id=v_store_id;
  end if;

  return jsonb_build_object('ok',true,'date',v_today,'offers',v_offer_count,'import_id',v_import.id,'parser',v_parser);
end;
$fn$;

do $do$
declare r record;
begin
  for r in select jobid from cron.job where jobname='refresh-billa-verified-health' loop
    perform cron.unschedule(r.jobid);
  end loop;
end
$do$;

select cron.schedule('refresh-billa-verified-health','42 * * * *',$cron$select public.refresh_billa_verified_health();$cron$);

select public.refresh_billa_verified_health();

create or replace function public.refresh_pepco_collection_health()
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $fn$
declare
  v_store_id uuid;
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_offer_count integer := 0;
  v_import_count integer := 0;
  v_latest_success timestamptz;
begin
  select id into v_store_id from public.stores where slug='pepco' limit 1;
  if v_store_id is null then
    return jsonb_build_object('ok',false,'error','Pepco store not found');
  end if;

  select count(*) into v_offer_count
  from public.offers
  where store_id=v_store_id
    and status='published'
    and valid_from<=v_today
    and valid_to>=v_today;

  select count(*),max(updated_at) into v_import_count,v_latest_success
  from public.leaflet_imports
  where store_id=v_store_id
    and status='published'
    and metadata->>'adapter'='pepco-collection-html-v2'
    and detected_valid_from<=v_today
    and detected_valid_to>=v_today
    and product_count>0;

  if v_offer_count>0 and v_import_count>0 then
    update public.store_product_sync_state
       set health_status='ok',
           health_reason=format('Pepco: %s aktuálních produktů publikováno ze specializované oficiální letákové kolekce.',v_offer_count),
           last_offer_count=v_offer_count,
           last_published_count=v_offer_count,
           last_success_at=coalesce(v_latest_success,last_success_at,now()),
           last_error=null,
           last_parser_error=null,
           adapter_name='pepco-collection-html-v2',
           adapter_version='pepco-collection-html-v2',
           updated_at=now()
     where store_id=v_store_id;
  else
    update public.store_product_sync_state
       set health_status='waiting_source',
           health_reason=format('Pepco: pro %s zatím není publikovaná aktuální oficiální kolekce.',v_today),
           last_offer_count=0,
           last_published_count=0,
           last_error=null,
           last_parser_error=null,
           updated_at=now()
     where store_id=v_store_id;
  end if;

  return jsonb_build_object('ok',true,'date',v_today,'offers',v_offer_count,'imports',v_import_count);
end;
$fn$;

do $do$
declare r record;
begin
  for r in select jobid from cron.job where jobname in ('sync-pepco-products','refresh-pepco-product-health') loop
    perform cron.unschedule(r.jobid);
  end loop;
end
$do$;

select cron.schedule(
  'sync-pepco-products',
  '17 */3 * * *',
  $cron$select private.invoke_edge_function('sync-pepco-source','{}'::jsonb,120000);$cron$
);

select cron.schedule(
  'refresh-pepco-product-health',
  '47 * * * *',
  $cron$select public.refresh_pepco_collection_health();$cron$
);

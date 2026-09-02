create or replace function public.refresh_pepco_collection_health()
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_store_id uuid;
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_offer_count integer := 0;
  v_import public.leaflet_imports%rowtype;
  v_source_success timestamptz;
begin
  select id into v_store_id from public.stores where slug='pepco' limit 1;
  if v_store_id is null then
    return jsonb_build_object('ok',false,'error','Pepco store not found');
  end if;

  select li.* into v_import
  from public.leaflet_imports li
  where li.store_id=v_store_id
    and li.status='published'
    and li.metadata->>'adapter'='pepco-collection-html-v2'
    and li.detected_valid_from<=v_today
    and li.detected_valid_to>=v_today
    and li.product_count>0
  order by li.updated_at desc
  limit 1;

  select max(ls.last_success_at) into v_source_success
  from public.leaflet_sources ls
  where ls.store_id=v_store_id
    and ls.source_url='https://pepco.cz/kolekce/letaky/'
    and ls.is_active=true;

  select count(*) into v_offer_count
  from public.offers
  where store_id=v_store_id
    and status='published'
    and valid_from<=v_today
    and valid_to>=v_today;

  if v_import.id is not null and v_offer_count>0 then
    update public.store_product_sync_state
       set health_status='ok',
           health_reason=format('Pepco: %s aktuálních produktů publikováno ze specializované oficiální letákové kolekce.',v_offer_count),
           last_run_at=now(),
           last_success_at=coalesce(v_source_success,v_import.updated_at,last_success_at,now()),
           last_offer_count=v_offer_count,
           last_published_count=v_offer_count,
           last_valid_from=v_import.detected_valid_from,
           last_valid_to=v_import.detected_valid_to,
           last_import_id=v_import.id,
           parser_version='pepco-collection-html-v2',
           source_type='official-collection-html',
           coverage_scope=coalesce(v_import.coverage_scope,'national'),
           source_category='current-offers',
           expected_offer_count=v_import.product_count,
           last_product_candidates=v_import.product_count,
           adapter_name='pepco-collection-html-v2',
           adapter_version='pepco-collection-html-v2',
           source_fingerprint=v_import.source_hash,
           product_set_hash=v_import.source_hash,
           last_error=null,
           last_parser_error=null,
           is_running=false,
           run_started_at=null,
           updated_at=now()
     where store_id=v_store_id;
  else
    update public.store_product_sync_state
       set health_status='waiting_source',
           health_reason=format('Pepco: pro %s zatím není publikovaná aktuální oficiální kolekce.',v_today),
           last_run_at=now(),
           last_success_at=coalesce(v_source_success,last_success_at),
           last_offer_count=0,
           last_published_count=0,
           last_error=null,
           last_parser_error=null,
           is_running=false,
           run_started_at=null,
           updated_at=now()
     where store_id=v_store_id;
  end if;

  return jsonb_build_object('ok',true,'date',v_today,'offers',v_offer_count,'import_id',v_import.id,'valid_from',v_import.detected_valid_from,'valid_to',v_import.detected_valid_to,'source_success_at',v_source_success);
end;
$function$;

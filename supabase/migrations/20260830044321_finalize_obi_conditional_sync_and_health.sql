create or replace function private.trigger_obi_product_sync_if_ready()
returns bigint
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $function$
declare
  v_import_id uuid;
  v_request_id bigint;
  v_now timestamptz:=now();
  v_today date:=(now() at time zone 'Europe/Prague')::date;
begin
  select li.id
    into v_import_id
  from public.leaflet_imports li
  join public.stores s on s.id=li.store_id
  join public.leaflet_extracted_text et on et.import_id=li.id and et.parser='pdf-text-v3'
  where s.slug='obi'
    and li.metadata->>'adapter'='obi-bonial-v1'
    and li.detected_valid_from<=v_today
    and li.detected_valid_to>=v_today
    and coalesce(li.metadata->>'structured_product_skip_reason','')<>'no_deterministic_sku_price_pairs'
    and coalesce((nullif(li.metadata->>'structured_product_synced_at',''))::timestamptz,'epoch'::timestamptz) < et.updated_at
    and (
      nullif(li.metadata->>'structured_product_sync_requested_at','') is null
      or (li.metadata->>'structured_product_sync_requested_at')::timestamptz < v_now-interval '2 hours'
    )
  order by li.detected_valid_from desc,li.created_at desc
  limit 1;

  if v_import_id is null then return null; end if;
  v_request_id:=private.invoke_edge_function('sync-obi-products','{}'::jsonb,120000);
  update public.leaflet_imports
     set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
       'structured_product_sync_requested_at',v_now,
       'structured_product_sync_request_id',v_request_id
     ),
     updated_at=v_now
   where id=v_import_id;
  return v_request_id;
end;
$function$;

create or replace function private.refresh_obi_health()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $function$
declare
  v_store_id uuid;
  v_count integer:=0;
  v_docs integer:=0;
  v_from date;
  v_to date;
  v_status text;
  v_reason text;
  v_now timestamptz:=now();
  v_today date:=(now() at time zone 'Europe/Prague')::date;
begin
  select id into v_store_id from public.stores where slug='obi';
  if v_store_id is null then return jsonb_build_object('ok',false,'error','OBI store missing'); end if;

  select count(*)::integer,min(valid_from),max(valid_to)
    into v_count,v_from,v_to
  from public.offers
  where store_id=v_store_id and status='published' and valid_from<=v_today and valid_to>=v_today;

  select count(*)::integer into v_docs
  from public.leaflet_imports
  where store_id=v_store_id
    and metadata->>'adapter'='obi-bonial-v1'
    and detected_valid_from<=v_today
    and detected_valid_to>=v_today
    and status in ('published','review');

  if v_count>0 then
    v_status:='ok';
    v_reason:=format('OBI: %s aktuálních ověřených nabídek z Bonial PDF + oficiálních produktových stránek.',v_count);
  elsif v_docs>0 then
    v_status:='degraded';
    v_reason:='OBI: aktuální oficiální Bonial brožura je dostupná, ale bezpečný parser v ní nemá aktuální cenové nabídky.';
  else
    v_status:='waiting_source';
    v_reason:='OBI: čeká se na nový aktuální oficiální Bonial leták.';
  end if;

  insert into public.store_product_sync_state(
    store_id,last_run_at,last_success_at,last_offer_count,expected_offer_count,last_published_count,last_valid_from,last_valid_to,
    last_error,last_parser_error,health_status,health_reason,is_running,run_started_at,parser_version,adapter_name,adapter_version,
    source_type,source_category,coverage_scope,updated_at
  ) values(
    v_store_id,v_now,case when v_count>0 then v_now else null end,v_count,v_count,v_count,v_from,v_to,
    null,null,v_status,v_reason,false,null,'obi-pdf-spatial-v1','obi-spatial-official','v1',
    'official-pdf-text+product-page','current-leaflet','national',v_now
  ) on conflict(store_id) do update set
    last_run_at=excluded.last_run_at,
    last_success_at=coalesce(excluded.last_success_at,public.store_product_sync_state.last_success_at),
    last_offer_count=excluded.last_offer_count,expected_offer_count=excluded.expected_offer_count,last_published_count=excluded.last_published_count,
    last_valid_from=excluded.last_valid_from,last_valid_to=excluded.last_valid_to,last_error=null,last_parser_error=null,
    health_status=excluded.health_status,health_reason=excluded.health_reason,is_running=false,run_started_at=null,
    parser_version=excluded.parser_version,adapter_name=excluded.adapter_name,adapter_version=excluded.adapter_version,
    source_type=excluded.source_type,source_category=excluded.source_category,coverage_scope=excluded.coverage_scope,updated_at=excluded.updated_at;

  return jsonb_build_object('ok',true,'current_offers',v_count,'current_documents',v_docs,'health_status',v_status);
end;
$function$;

do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='sync_obi_products_daily';
  if v_job is not null then perform cron.unschedule(v_job); end if;

  select jobid into v_job from cron.job where jobname='refresh-obi-health';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule('refresh-obi-health','37 */6 * * *',$cron$select private.refresh_obi_health();$cron$);
end $$;

select private.refresh_obi_health();

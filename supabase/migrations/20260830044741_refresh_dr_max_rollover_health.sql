create or replace function private.refresh_dr_max_health()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $function$
declare
  v_store_id uuid;
  v_offer_count integer:=0;
  v_doc_count integer:=0;
  v_from date;
  v_to date;
  v_status text;
  v_reason text;
  v_adapter text;
  v_source_type text;
  v_now timestamptz:=now();
  v_today date:=(now() at time zone 'Europe/Prague')::date;
begin
  select id into v_store_id from public.stores where slug='dr-max';
  if v_store_id is null then return jsonb_build_object('ok',false,'error','Dr. Max store missing'); end if;

  select count(*)::integer,min(valid_from),max(valid_to)
    into v_offer_count,v_from,v_to
  from public.offers
  where store_id=v_store_id
    and status='published'
    and is_verified=true
    and valid_from<=v_today
    and valid_to>=v_today;

  select count(*)::integer into v_doc_count
  from public.leaflet_imports
  where store_id=v_store_id
    and metadata->>'adapter'='drmax-triobo-v1'
    and status='published'
    and detected_valid_from<=v_today
    and detected_valid_to>=v_today;

  if v_offer_count>0 then
    v_status:='ok';
    v_reason:=format('Dr. Max: %s aktuálních ručně/retailerem ověřených nabídek; oficiální Triobo leták je zdroj dokumentu.',v_offer_count);
    v_adapter:='drmax-verified-manual-products-v1';
    v_source_type:='official-triobo+official-product-pages';
  elsif v_doc_count>0 then
    v_status:='degraded';
    v_reason:='Dr. Max: aktuální oficiální Triobo leták je dostupný, ale pro toto vydání zatím není bezpečně ověřená automatická produktová extrakce.';
    v_adapter:='drmax-triobo-document-v1';
    v_source_type:='official-triobo-document';
  else
    v_status:='waiting_source';
    v_reason:='Dr. Max: čeká se na nové aktuální oficiální vydání letáku.';
    v_adapter:='drmax-triobo-document-v1';
    v_source_type:='official-triobo-document';
  end if;

  insert into public.store_product_sync_state(
    store_id,last_run_at,last_success_at,last_offer_count,expected_offer_count,last_published_count,
    last_valid_from,last_valid_to,last_error,last_parser_error,health_status,health_reason,is_running,run_started_at,
    adapter_name,adapter_version,source_type,source_category,coverage_scope,updated_at
  ) values(
    v_store_id,v_now,case when v_offer_count>0 then v_now else null end,v_offer_count,v_offer_count,v_offer_count,
    v_from,v_to,null,null,v_status,v_reason,false,null,v_adapter,'v1',v_source_type,'current-leaflet','national',v_now
  ) on conflict(store_id) do update set
    last_run_at=excluded.last_run_at,
    last_success_at=coalesce(excluded.last_success_at,public.store_product_sync_state.last_success_at),
    last_offer_count=excluded.last_offer_count,expected_offer_count=excluded.expected_offer_count,last_published_count=excluded.last_published_count,
    last_valid_from=excluded.last_valid_from,last_valid_to=excluded.last_valid_to,last_error=null,last_parser_error=null,
    health_status=excluded.health_status,health_reason=excluded.health_reason,is_running=false,run_started_at=null,
    adapter_name=excluded.adapter_name,adapter_version=excluded.adapter_version,source_type=excluded.source_type,
    source_category=excluded.source_category,coverage_scope=excluded.coverage_scope,updated_at=excluded.updated_at;

  return jsonb_build_object('ok',true,'current_offers',v_offer_count,'current_documents',v_doc_count,'health_status',v_status);
end;
$function$;

do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='refresh-dr-max-health';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule('refresh-dr-max-health','23 */6 * * *',$cron$select private.refresh_dr_max_health();$cron$);
end $$;

select private.refresh_dr_max_health();

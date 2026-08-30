create or replace function private.refresh_makro_health()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $function$
declare
  v_store_id uuid; v_count integer:=0; v_gross integer:=0; v_from date; v_to date; v_newest timestamptz; v_docs integer:=0; v_status text; v_reason text;
begin
  select id into v_store_id from public.stores where slug='makro' limit 1;
  if v_store_id is null then return jsonb_build_object('ok',false,'error','MAKRO store missing'); end if;

  select count(*)::integer,
         count(*) filter(where o.metadata->>'structured_source'='makro-catalog-gross-pdf-v1' and coalesce((o.metadata->>'gross_price_verified')::boolean,false)=true)::integer,
         min(o.valid_from),max(o.valid_to),max(o.updated_at)
    into v_count,v_gross,v_from,v_to,v_newest
  from public.offers o
  where o.store_id=v_store_id and o.status='published' and o.is_verified=true
    and o.valid_from<=(now() at time zone 'Europe/Prague')::date
    and o.valid_to>=(now() at time zone 'Europe/Prague')::date;

  select count(*)::integer into v_docs
  from public.leaflet_imports li
  where li.store_id=v_store_id and li.status='published'
    and li.detected_valid_from<=(now() at time zone 'Europe/Prague')::date
    and li.detected_valid_to>=(now() at time zone 'Europe/Prague')::date
    and (li.metadata->>'adapter' ilike '%makro%' or li.source_document_url ilike '%publitas%');

  if v_count>0 and v_gross=v_count then
    v_status:='ok';
    v_reason:=format('MAKRO: %s aktuálních maloobchodních nabídek s brutto cenou ověřenou přímo v oficiálním PDF letáku.',v_count);
  elsif v_docs>0 then
    v_status:='degraded';
    v_reason:='MAKRO: oficiální maloobchodní leták je dostupný, ale aktuální produktová sada nemá plně ověřenou brutto cenu.';
  else
    v_status:='waiting_source';
    v_reason:='MAKRO: čeká se na aktuální oficiální maloobchodní leták.';
  end if;

  update public.store_product_sync_state
  set health_status=v_status,health_reason=v_reason,last_offer_count=v_count,last_published_count=v_count,
      expected_offer_count=case when v_count>0 then v_count else expected_offer_count end,
      last_valid_from=v_from,last_valid_to=v_to,
      last_success_at=case when v_count>0 then coalesce(v_newest,last_success_at,now()) else last_success_at end,
      last_error=case when v_status='ok' then null else last_error end,
      last_parser_error=case when v_status='ok' then null else last_parser_error end,
      adapter_name=case when v_status='ok' then 'makro-catalog-gross-pdf-v1' else adapter_name end,
      adapter_version=case when v_status='ok' then 'v1' else adapter_version end,
      source_type=case when v_status='ok' then 'official-pdf-gross-price' else source_type end,
      updated_at=now()
  where store_id=v_store_id;

  return jsonb_build_object('ok',true,'health_status',v_status,'current_offers',v_count,'gross_verified',v_gross,'current_documents',v_docs,'valid_from',v_from,'valid_to',v_to);
end;
$function$;

create or replace function private.recover_known_store_automation(p_action text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $function$
declare v_request bigint; v_secondary bigint; v_result jsonb;
begin
  case p_action
    when 'globus_products' then v_request := private.invoke_edge_function('sync-globus-products',jsonb_build_object('dry_run',false),120000);
    when 'hm_products' then v_request := private.invoke_edge_function('sync-hm-products',jsonb_build_object('dry_run',false),120000);
    when 'makro_health' then v_result := private.refresh_makro_health();
    when 'makro_source' then v_request := private.invoke_edge_function('sync-makro-source','{}'::jsonb,120000);
    when 'pilulka_products' then v_request := private.invoke_edge_function('sync-pilulka-products',jsonb_build_object('dry_run',false),120000);
    when 'zabka_products' then v_request := private.invoke_edge_function('sync-zabka-products','{}'::jsonb,120000);
    when 'kosik_products' then v_request := private.invoke_edge_function('sync-kosik-products','{}'::jsonb,120000);
    when 'intersport_products' then v_request := public.invoke_intersport_products_sync();
    when 'pro_doma_verified' then v_request := public.trigger_pro_doma_verified_sync();
    when 'billa_verified' then v_request := public.invoke_billa_publitas_sync();
    when 'penny_structured' then v_request := public.trigger_penny_structured_sync();
    when 'lidl_verified' then v_request := public.trigger_lidl_verified_sync();
    when 'action_products' then perform public.invoke_action_source_sync(); v_request := public.invoke_action_products_sync();
    when 'terno_products' then v_request := private.invoke_edge_function('sync-terno-ocr-products-v4',jsonb_build_object('dry_run',false),120000);
    when 'norma_products' then v_request := private.invoke_edge_function('sync-norma-pdf-products-v7',jsonb_build_object('dry_run',false),120000);
    when 'obi_pipeline' then v_request := private.invoke_edge_function('sync-obi-source','{}'::jsonb,120000); perform private.trigger_obi_missing_extractions(); v_secondary := private.trigger_obi_product_sync_if_ready();
    when 'kik_rollover' then v_request := private.trigger_kik_source_if_due(); v_secondary := private.trigger_kik_products_if_due();
    when 'moebelix_verified' then v_request := public.trigger_moebelix_verified_sync();
    when 'xxxlutz_verified' then v_request := public.trigger_xxxlutz_verified_sync();
    when 'tesco_current' then v_request := public.trigger_tesco_current_sync();
    when 'benu_pipeline' then v_request := private.invoke_edge_function('run-leaflet-pipeline-v2',jsonb_build_object('store_slug','benu'),120000);
    when 'auto_kelly' then v_request := private.invoke_edge_function('sync-auto-kelly-products','{}'::jsonb,120000);
    when 'drmax_source' then v_request := private.invoke_edge_function('sync-dr-max-source','{}'::jsonb,120000);
    else return jsonb_build_object('handled',false,'action',p_action,'reason','unknown_store_recovery_action');
  end case;
  return jsonb_build_object('handled',true,'action',p_action,'request_id',v_request,'secondary_request_id',v_secondary,'result',v_result);
exception when others then return jsonb_build_object('handled',true,'action',p_action,'error',sqlerrm);
end;
$function$;

update private.automation_watchdog_store_targets
set recovery_action='makro_health',cooldown=interval '30 minutes',updated_at=now()
where store_slug='makro';

create or replace function private.run_automation_watchdog_preflight()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','cron','net','pg_temp'
as $function$
declare
  r record; v_today date := (now() at time zone 'Europe/Prague')::date; v_tomorrow date:=v_today+1;
  v_local timestamp:=now() at time zone 'Europe/Prague'; v_stale_running integer:=0; v_stale_imports integer:=0;
  v_stale_http integer:=0; v_count_mismatch integer:=0; v_rollover_risks integer:=0; v_rollover_recovery jsonb:=null;
  v_actual integer; v_today_count integer; v_tomorrow_count integer; v_risk boolean; v_coverage_healthy boolean; v_reason text;
begin
  for r in select s.slug,st.run_started_at,st.last_run_at,st.last_success_at,st.health_status,st.last_error from public.store_product_sync_state st join public.stores s on s.id=st.store_id where st.is_running=true and st.run_started_at is not null and st.run_started_at<now()-interval '20 minutes' loop
    perform private.record_automation_watchdog_incident(format('store-stale-running:%s',r.slug),'store_sync_stale_running','error',r.slug,null,null,jsonb_build_object('run_started_at',r.run_started_at,'last_run_at',r.last_run_at,'last_success_at',r.last_success_at,'health_status',r.health_status,'last_error',r.last_error)); v_stale_running:=v_stale_running+1;
  end loop;

  for r in select li.id,s.slug,li.status,li.updated_at,li.source_document_url,li.error_message from public.leaflet_imports li join public.stores s on s.id=li.store_id where li.status in ('queued','downloading','processing','publishing') and li.updated_at<now()-interval '45 minutes' loop
    perform private.record_automation_watchdog_incident(format('stale-import:%s',r.id),'stale_leaflet_import','error',r.slug,null,null,jsonb_build_object('import_id',r.id,'status',r.status,'updated_at',r.updated_at,'source_document_url',r.source_document_url,'error_message',r.error_message)); v_stale_imports:=v_stale_imports+1;
  end loop;

  for r in select j.request_id,s.slug,j.adapter,j.requested_at,j.metadata from public.structured_retail_http_jobs j join public.stores s on s.id=j.store_id where j.status='pending' and j.requested_at<now()-interval '25 minutes' loop
    perform private.record_automation_watchdog_incident(format('stale-structured-http:%s',r.request_id),'stale_structured_http_job','error',r.slug,null,r.request_id,jsonb_build_object('adapter',r.adapter,'requested_at',r.requested_at,'metadata',r.metadata)); v_stale_http:=v_stale_http+1;
  end loop;

  for r in select s.slug,st.store_id,st.last_offer_count,st.last_run_at,st.last_success_at,st.updated_at from public.store_product_sync_state st join public.stores s on s.id=st.store_id where st.health_status='ok' and s.slug<>'kaufland' and st.updated_at<now()-interval '5 minutes' loop
    select count(*)::integer into v_actual from public.offers o where o.store_id=r.store_id and o.status='published' and o.is_verified=true and o.valid_from<=v_today and o.valid_to>=v_today;
    if coalesce(r.last_offer_count,0)<>v_actual then
      perform private.record_automation_watchdog_incident(format('health-count-mismatch:%s',r.slug),'health_count_mismatch','warning',r.slug,null,null,jsonb_build_object('health_count',coalesce(r.last_offer_count,0),'actual_current_count',v_actual,'last_run_at',r.last_run_at,'last_success_at',r.last_success_at,'state_updated_at',r.updated_at)); v_count_mismatch:=v_count_mismatch+1;
    end if;
  end loop;

  for r in select * from private.rollover_sync_targets where enabled=true loop
    select count(*) filter(where status='published' and is_verified=true and valid_from<=v_today and valid_to>=v_today),count(*) filter(where status='published' and is_verified=true and valid_from<=v_tomorrow and valid_to>=v_tomorrow) into v_today_count,v_tomorrow_count from public.offers where store_id=(select id from public.stores where slug=r.store_slug limit 1);
    v_coverage_healthy:=coalesce(v_today_count,0)>=r.min_today_offers and (r.mode not in ('next_day_prefetch','source_refresh') or r.min_tomorrow_offers=0 or v_local::time<r.prefetch_after or coalesce(v_tomorrow_count,0)>=r.min_tomorrow_offers);
    v_risk:=false; v_reason:=null;
    if not v_coverage_healthy and r.last_status='error' then v_risk:=true; v_reason:='supervisor_target_error';
    elsif not v_coverage_healthy and r.last_status='running' and r.updated_at<now()-interval '15 minutes' then v_risk:=true; v_reason:='supervisor_target_stuck_running';
    elsif r.mode in ('daily_snapshot','current_day') and v_local::time>=time '00:10' and v_local::time<time '02:00' and coalesce(v_today_count,0)<r.min_today_offers then v_risk:=true; v_reason:=format('post_midnight_today_below_threshold:%s<%s',coalesce(v_today_count,0),r.min_today_offers);
    elsif r.mode in ('next_day_prefetch','source_refresh') and r.min_tomorrow_offers>0 and v_local::time>=r.prefetch_after and coalesce(v_today_count,0)>=r.min_today_offers and coalesce(v_tomorrow_count,0)<r.min_tomorrow_offers and (r.last_triggered_at is null or r.last_triggered_at<now()-r.cooldown) then v_risk:=true; v_reason:=format('prefetch_missing:%s<%s',coalesce(v_tomorrow_count,0),r.min_tomorrow_offers);
    end if;
    if v_risk then
      perform private.record_automation_watchdog_incident(format('rollover-risk:%s',r.store_slug),'rollover_risk','critical',r.store_slug,null,r.last_request_id,jsonb_build_object('mode',r.mode,'action',r.action,'today_count',coalesce(v_today_count,0),'tomorrow_count',coalesce(v_tomorrow_count,0),'reason',v_reason,'last_status',r.last_status,'last_reason',r.last_reason,'last_triggered_at',r.last_triggered_at)); v_rollover_risks:=v_rollover_risks+1;
    end if;
  end loop;

  if v_rollover_risks>0 then begin v_rollover_recovery:=public.run_rollover_supervisor(); exception when others then v_rollover_recovery:=jsonb_build_object('ok',false,'error',sqlerrm); end; end if;
  update private.automation_watchdog_incidents set status='resolved',resolved_at=now() where status='open' and incident_type in ('store_sync_stale_running','stale_leaflet_import','stale_structured_http_job','health_count_mismatch','rollover_risk') and last_seen_at<now()-interval '20 minutes';
  return jsonb_build_object('stale_running_seen',v_stale_running,'stale_imports_seen',v_stale_imports,'stale_structured_http_seen',v_stale_http,'health_count_mismatch_seen',v_count_mismatch,'rollover_risks_seen',v_rollover_risks,'rollover_recovery',v_rollover_recovery);
end;
$function$;

select private.refresh_makro_health();

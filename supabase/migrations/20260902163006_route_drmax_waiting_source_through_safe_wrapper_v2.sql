select cron.unschedule('sync-dr-max-official-source');
select cron.schedule(
  'sync-dr-max-official-source',
  '18 */6 * * *',
  $$select private.invoke_edge_function('sync-dr-max-source-safe','{}'::jsonb,120000);$$
);

create or replace function private.recover_known_store_automation(p_action text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $function$
declare
  v_request bigint;
  v_secondary bigint;
  v_result jsonb;
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
    when 'drmax_source' then v_request := private.invoke_edge_function('sync-dr-max-source-safe','{}'::jsonb,120000);
    when 'dek_products' then v_request := private.invoke_edge_function('sync-dek-products','{}'::jsonb,120000);
    else return jsonb_build_object('handled',false,'action',p_action,'reason','unknown_store_recovery_action');
  end case;

  return jsonb_build_object('handled',true,'action',p_action,'request_id',v_request,'secondary_request_id',v_secondary,'result',v_result);
exception when others then
  return jsonb_build_object('handled',true,'action',p_action,'error',sqlerrm);
end;
$function$;

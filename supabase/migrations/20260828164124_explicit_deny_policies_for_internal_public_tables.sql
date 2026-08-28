do $$
declare
  v_table text;
  v_tables text[] := array[
    'albert_offer_staging',
    'albert_product_sync_runs',
    'branch_sync_http_batch',
    'branch_sync_http_state',
    'kaufland_parser_config',
    'kaufland_product_sync_audit',
    'leaflet_basic_parser_runs',
    'leaflet_cold_rebuild_import_backup',
    'leaflet_cold_rebuild_item_backup',
    'leaflet_cold_rebuild_offer_backup',
    'leaflet_cold_rebuild_price_history_backup',
    'leaflet_cold_rebuild_runs',
    'leaflet_extracted_text',
    'leaflet_ocr_pages',
    'leaflet_storage_cleanup_log',
    'offer_bulk_reset_runs',
    'pilulka_catalog_http_state',
    'price_history_quarantine',
    'shopping_list_add_mutations',
    'shopping_purchase_repeat_mutations',
    'structured_retail_http_jobs',
    'web_push_deliveries',
    'web_push_subscriptions'
  ];
begin
  foreach v_table in array v_tables loop
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = v_table
        and policyname = 'deny_client_access'
    ) then
      execute format(
        'create policy deny_client_access on public.%I for all to anon, authenticated using (false) with check (false)',
        v_table
      );
    end if;
  end loop;
end
$$;

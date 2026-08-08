-- Internal SECURITY DEFINER functions must never be callable by anonymous visitors.
-- Keep authenticated access for the existing admin UI and service_role for Edge Functions.
-- Public shopping-list/search RPCs are intentionally not included here.

revoke execute on function public.archive_and_delete_expired_offers() from public, anon;
revoke execute on function public.archive_expired_document_leaflet_imports() from public, anon;
revoke execute on function public.balance_product_image_candidate_review() from public, anon;
revoke execute on function public.cleanup_stale_leaflet_imports() from public, anon;
revoke execute on function public.expire_old_offers() from public, anon;
revoke execute on function public.guard_leaflet_import_terminal_status() from public, anon;
revoke execute on function public.handle_leaflet_ai_credit_failure() from public, anon;
revoke execute on function public.handle_new_user() from public, anon;
revoke execute on function public.handle_tesco_leaflet_403() from public, anon;
revoke execute on function public.match_offer_to_product_master() from public, anon;
revoke execute on function public.normalize_manual_leaflet_batch() from public, anon;
revoke execute on function public.preserve_automatic_pdf_batch_validity() from public, anon;
revoke execute on function public.propagate_manual_leaflet_batch_validity() from public, anon;
revoke execute on function public.queue_leaflet_crop_backfill(integer) from public, anon;
revoke execute on function public.queue_product_catalog_matching(integer) from public, anon;
revoke execute on function public.reactivate_leaflet_source_after_success() from public, anon;
revoke execute on function public.recheck_paused_leaflet_sources(integer) from public, anon;
revoke execute on function public.reconcile_kaufland_cold_rebuild_after_product_sync() from public, anon;
revoke execute on function public.reject_non_leaflet_import_document() from public, anon;
revoke execute on function public.reject_non_leaflet_source_document() from public, anon;
revoke execute on function public.reject_public_leaflet_crop_image() from public, anon;
revoke execute on function public.reset_offer_catalog_match_on_identity_change() from public, anon;
revoke execute on function public.restore_trash_after_verified_leaflet_source() from public, anon;
revoke execute on function public.route_kaufland_pdf_before_insert() from public, anon;
revoke execute on function public.start_leaflet_product_crops_after_status() from public, anon;
revoke execute on function public.start_routed_kaufland_pdf_after_insert() from public, anon;
revoke execute on function public.sync_leaflet_import_status_from_items() from public, anon;
revoke execute on function public.trigger_leaflet_discovery() from public, anon;
revoke execute on function public.trigger_leaflet_ocr(uuid) from public, anon;
revoke execute on function public.trigger_leaflet_pipeline_v2(text) from public, anon;
revoke execute on function public.trigger_tesco_current_sync() from public, anon;
revoke execute on function public.trigger_tesco_viewer_inspection() from public, anon;

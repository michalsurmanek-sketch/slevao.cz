-- Internal job launchers can read vault secrets and/or mutate production state.
-- They are invoked by database automation or service-role Edge Functions, not by end users.

revoke execute on function public.expire_old_offers() from public, anon, authenticated;
revoke execute on function public.queue_leaflet_crop_backfill(integer) from public, anon, authenticated;
revoke execute on function public.queue_product_catalog_matching(integer) from public, anon, authenticated;
revoke execute on function public.start_leaflet_product_crops_after_status() from public, anon, authenticated;
revoke execute on function public.trigger_leaflet_ocr(uuid) from public, anon, authenticated;
revoke execute on function public.trigger_tesco_viewer_inspection() from public, anon, authenticated;

-- Keep the internal execution path explicit.
grant execute on function public.expire_old_offers() to service_role;
grant execute on function public.queue_leaflet_crop_backfill(integer) to service_role;
grant execute on function public.queue_product_catalog_matching(integer) to service_role;
grant execute on function public.trigger_leaflet_ocr(uuid) to service_role;
grant execute on function public.trigger_tesco_viewer_inspection() to service_role;

-- Trigger functions do not require an EXECUTE grant to client roles; PostgreSQL invokes
-- them through the trigger itself under the function owner's privileges.

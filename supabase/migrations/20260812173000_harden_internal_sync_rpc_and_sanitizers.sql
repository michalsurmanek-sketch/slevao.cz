-- Restrict internal sync launchers to the server role and pin sanitizer lookup paths.

revoke all on function public.invoke_action_products_sync() from public, anon, authenticated;
grant execute on function public.invoke_action_products_sync() to service_role;

revoke all on function public.invoke_action_source_sync() from public, anon, authenticated;
grant execute on function public.invoke_action_source_sync() to service_role;

revoke all on function public.trigger_albert_product_sync_dry_run() from public, anon, authenticated;
grant execute on function public.trigger_albert_product_sync_dry_run() to service_role;

alter function public.sanitize_hruska_coordinate_title(text) set search_path = pg_catalog, public;
alter function public.sanitize_hruska_coordinate_item_title() set search_path = pg_catalog, public;
alter function public.sanitize_billa_coordinate_title(text) set search_path = pg_catalog, public;
alter function public.sanitize_billa_coordinate_item_title() set search_path = pg_catalog, public;

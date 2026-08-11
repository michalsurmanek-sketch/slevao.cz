-- Supabase grants EXECUTE on new public-schema functions to API roles by
-- default. These maintenance RPCs are internal only.
revoke execute on function public.get_expired_leaflet_storage_cleanup_candidates(integer,integer) from public, anon, authenticated;
revoke execute on function public.get_orphan_leaflet_storage_cleanup_candidates(integer,integer) from public, anon, authenticated;
revoke execute on function public.finalize_leaflet_storage_cleanup(jsonb) from public, anon, authenticated;
revoke execute on function public.log_orphan_leaflet_storage_cleanup(jsonb) from public, anon, authenticated;
revoke execute on function public.trigger_expired_leaflet_storage_cleanup() from public, anon, authenticated;

grant execute on function public.get_expired_leaflet_storage_cleanup_candidates(integer,integer) to service_role;
grant execute on function public.get_orphan_leaflet_storage_cleanup_candidates(integer,integer) to service_role;
grant execute on function public.finalize_leaflet_storage_cleanup(jsonb) to service_role;
grant execute on function public.log_orphan_leaflet_storage_cleanup(jsonb) to service_role;
grant execute on function public.trigger_expired_leaflet_storage_cleanup() to service_role;

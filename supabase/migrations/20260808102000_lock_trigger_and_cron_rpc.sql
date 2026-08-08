-- Trigger functions are executable by the database trigger machinery; clients never need
-- direct EXECUTE access. Remove inherited/public access from every SECURITY DEFINER trigger.
do $$
declare
  fn record;
begin
  for fn in
    select distinct p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_trigger t on t.tgfoid = p.oid
    where n.nspname = 'public'
      and p.prosecdef
      and not t.tgisinternal
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn.signature);
  end loop;
end
$$;

-- These functions are scheduled by pg_cron and do not need direct client execution.
revoke execute on function public.archive_and_delete_expired_offers() from public, anon, authenticated;
revoke execute on function public.archive_expired_document_leaflet_imports() from public, anon, authenticated;
revoke execute on function public.cleanup_stale_leaflet_imports() from public, anon, authenticated;
revoke execute on function public.recheck_paused_leaflet_sources(integer) from public, anon, authenticated;
revoke execute on function public.trigger_leaflet_discovery() from public, anon, authenticated;
revoke execute on function public.trigger_leaflet_pipeline_v2(text) from public, anon, authenticated;
revoke execute on function public.trigger_tesco_current_sync() from public, anon, authenticated;

-- Edge Functions using service_role keep explicit access if PostgreSQL defaults ever change.
grant execute on function public.archive_and_delete_expired_offers() to service_role;
grant execute on function public.archive_expired_document_leaflet_imports() to service_role;
grant execute on function public.cleanup_stale_leaflet_imports() to service_role;
grant execute on function public.recheck_paused_leaflet_sources(integer) to service_role;
grant execute on function public.trigger_leaflet_discovery() to service_role;
grant execute on function public.trigger_leaflet_pipeline_v2(text) to service_role;
grant execute on function public.trigger_tesco_current_sync() to service_role;

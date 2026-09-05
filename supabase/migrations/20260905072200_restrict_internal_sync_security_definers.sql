revoke execute on function public.stage_globus_offer_chunk(text, jsonb) from public, anon, authenticated;
grant execute on function public.stage_globus_offer_chunk(text, jsonb) to service_role;

revoke execute on function public.finalize_globus_staged_offers(text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.finalize_globus_staged_offers(text, text, text, integer, integer) to service_role;

revoke execute on function public.propagate_globus_source_categories(jsonb) from public, anon, authenticated;
grant execute on function public.propagate_globus_source_categories(jsonb) to service_role;

revoke execute on function public.refresh_billa_verified_health() from public, anon, authenticated;
grant execute on function public.refresh_billa_verified_health() to service_role;

revoke execute on function public.refresh_pepco_collection_health() from public, anon, authenticated;
grant execute on function public.refresh_pepco_collection_health() to service_role;

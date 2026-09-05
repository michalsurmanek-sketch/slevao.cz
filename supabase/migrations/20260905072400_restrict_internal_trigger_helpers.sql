revoke execute on function public.propagate_rohlik_offer_amount_v78() from public, anon, authenticated;
grant execute on function public.propagate_rohlik_offer_amount_v78() to service_role;

revoke execute on function public.sync_dm_product_context_from_offer() from public, anon, authenticated;
grant execute on function public.sync_dm_product_context_from_offer() to service_role;

revoke execute on function public.sync_pro_doma_source_health_from_index_job() from public, anon, authenticated;
grant execute on function public.sync_pro_doma_source_health_from_index_job() to service_role;

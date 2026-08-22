alter function public.merge_duplicate_active_price_alert() security invoker;

revoke all on function public.merge_duplicate_active_price_alert() from public, anon, authenticated;
grant execute on function public.merge_duplicate_active_price_alert() to service_role;

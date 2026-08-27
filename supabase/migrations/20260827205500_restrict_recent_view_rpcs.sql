-- Supabase can retain explicit anon EXECUTE grants independently of PUBLIC.
-- Recent-view mutation RPCs are signed-in user operations only.

revoke execute on function public.record_recent_product_view(uuid) from anon;
revoke execute on function public.claim_recent_product_views(jsonb) from anon;
revoke execute on function public.record_recent_product_view(uuid) from public;
revoke execute on function public.claim_recent_product_views(jsonb) from public;

grant execute on function public.record_recent_product_view(uuid) to authenticated, service_role;
grant execute on function public.claim_recent_product_views(jsonb) to authenticated, service_role;

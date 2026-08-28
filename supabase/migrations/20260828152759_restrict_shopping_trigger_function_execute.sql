revoke all on function public.guard_shopping_list_selected_offer() from public, anon, authenticated;
grant execute on function public.guard_shopping_list_selected_offer() to postgres, service_role;

revoke all on function public.validate_shopping_purchase_snapshot() from public, anon, authenticated;
grant execute on function public.validate_shopping_purchase_snapshot() to postgres, service_role;

revoke execute on function public.create_shopping_list_share(uuid,text,integer) from anon;
revoke execute on function public.revoke_shopping_list_shares(uuid) from anon;
revoke execute on function public.resolve_shopping_list_share(text) from anon, authenticated;

grant execute on function public.create_shopping_list_share(uuid,text,integer) to authenticated;
grant execute on function public.revoke_shopping_list_shares(uuid) to authenticated;
grant execute on function public.get_shared_shopping_list(text) to anon, authenticated;
grant execute on function public.mutate_shared_shopping_list(text,text,uuid,uuid,uuid,text,numeric,text,boolean) to anon, authenticated;
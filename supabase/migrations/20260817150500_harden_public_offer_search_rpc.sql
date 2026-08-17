alter function public.search_public_offers(text,integer,integer,text,boolean) security invoker;
grant execute on function public.search_public_offers(text,integer,integer,text,boolean) to anon, authenticated, service_role;

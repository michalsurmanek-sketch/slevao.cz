alter function public.public_semantic_offer_matches(text,text[],text,text) security definer;
alter function public.public_semantic_offer_matches(text,text[],text,text) set search_path = 'public','pg_temp';

alter function public.get_public_semantic_filter_counts(text[],boolean,text,numeric,numeric,boolean,text,text,text) security definer;
alter function public.get_public_semantic_filter_counts(text[],boolean,text,numeric,numeric,boolean,text,text,text) set search_path = 'public','pg_temp';

revoke all on function public.public_semantic_offer_matches_normalized(text,text[],text,text) from public;
revoke all on function public.public_semantic_offer_matches_normalized(text,text[],text,text) from anon;
revoke all on function public.public_semantic_offer_matches_normalized(text,text[],text,text) from authenticated;
revoke all on function public.public_semantic_offer_matches_normalized(text,text[],text,text) from service_role;

revoke all on function public.public_semantic_offer_matches(text,text[],text,text) from public;
revoke all on function public.get_public_semantic_filter_counts(text[],boolean,text,numeric,numeric,boolean,text,text,text) from public;

grant execute on function public.public_semantic_offer_matches(text,text[],text,text) to anon, authenticated, service_role;
grant execute on function public.get_public_semantic_filter_counts(text[],boolean,text,numeric,numeric,boolean,text,text,text) to anon, authenticated, service_role;
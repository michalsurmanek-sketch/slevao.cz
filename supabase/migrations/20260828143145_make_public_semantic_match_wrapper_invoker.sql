grant execute on function public.public_semantic_offer_matches_normalized(text, text[], text, text) to anon;
grant execute on function public.public_semantic_offer_matches_normalized(text, text[], text, text) to authenticated;
alter function public.public_semantic_offer_matches(text, text[], text, text) security invoker;

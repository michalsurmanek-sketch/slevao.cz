alter function public.get_public_offer_facets(boolean,text,numeric,numeric,boolean,text,text,text,text,text)
  set search_path = public, extensions, pg_temp;

alter function public.get_public_offer_page_filtered(integer,integer,boolean,text,numeric,numeric,boolean,text,text,text,text,text,text)
  set search_path = public, extensions, pg_temp;

alter function public.get_public_saved_offer_page(uuid[],integer,integer,text,numeric,numeric,boolean,text,text,text,text,text)
  set search_path = public, extensions, pg_temp;

alter function public.public_search_matches(text,text)
  set search_path = public, extensions, pg_temp;

alter function public.public_search_matches_v2(text,text)
  set search_path = public, extensions, pg_temp;

alter function public.search_products_catalog(text,integer)
  set search_path = public, extensions, pg_temp;

alter function public.search_public_offers(text,integer,integer,text,boolean)
  set search_path = public, extensions, pg_temp;

alter extension pg_trgm set schema extensions;

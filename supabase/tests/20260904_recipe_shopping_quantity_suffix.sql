-- Regression guard for recipe quantity suffix matching.
-- This deliberately avoids current offer IDs/prices so it stays stable as flyers change.

do $$
declare
  fn_source text;
  returned_query text;
begin
  select p.prosrc
    into fn_source
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'get_public_shopping_list_candidates'
    and pg_get_function_identity_arguments(p.oid) = 'p_queries text[], p_limit_per_query integer';

  if fn_source is null then
    raise exception 'get_public_shopping_list_candidates(text[], integer) is missing';
  end if;

  if fn_source not like '%regexp_replace(%'
     or fn_source not like '%kg|g|ml|l|ks|balení|stroužek|stroužky|stroužků%'
     or fn_source not like '%as base_text%'
     or fn_source not like '%p_query=>rec.search_text%'
  then
    raise exception 'recipe quantity suffix is not stripped before offer search';
  end if;

  if fn_source like '%normalize_search_text%'
     or fn_source like '%page_row.row_number%'
  then
    raise exception 'obsolete shopping-candidate dependency returned';
  end if;

  if fn_source not like '%rec.query_text,%'
     or fn_source not like '%recipe_required_amount%'
     or fn_source not like '%recipe_required_unit%'
  then
    raise exception 'display label / recipe amount metadata contract is missing';
  end if;

  select c.query_text
    into returned_query
  from public.get_public_shopping_list_candidates(array['Hovězí maso (800 g)'], 1) c
  limit 1;

  if returned_query is distinct from 'Hovězí maso (800 g)' then
    raise exception 'recipe display label changed: %', returned_query;
  end if;
end
$$;

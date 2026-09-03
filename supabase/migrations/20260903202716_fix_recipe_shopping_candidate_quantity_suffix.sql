CREATE OR REPLACE FUNCTION public.get_public_shopping_list_candidates(
  p_queries text[],
  p_limit_per_query integer DEFAULT 30
)
RETURNS TABLE(
  query_text text,
  query_key text,
  candidate_rank integer,
  offer jsonb,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  rec record;
begin
  for rec in
    select
      q.query_text,
      coalesce(
        nullif(
          btrim(regexp_replace(
            q.query_text,
            '[[:space:]]*\([[:space:]]*[0-9]+([.,][0-9]+)?[[:space:]]+(kg|g|ml|l|ks|balení|stroužky)[[:space:]]*\)[[:space:]]*$',
            '',
            'i'
          )),
          ''
        ),
        q.query_text
      ) as search_text,
      q.query_ord
    from (
      select btrim(value) as query_text, ordinality as query_ord
      from unnest(coalesce(p_queries, array[]::text[])) with ordinality as u(value, ordinality)
    ) q
    where q.query_text <> ''
    order by q.query_ord
  loop
    return query
    select
      rec.query_text,
      lower(btrim(regexp_replace(public.unaccent(rec.query_text), '[^a-zA-Z0-9]+', ' ', 'g'))) as query_key,
      page_row.candidate_ord::integer,
      page_row.offer,
      page_row.total_count
    from public.get_public_offer_page_filtered(
      p_limit => greatest(1, least(coalesce(p_limit_per_query, 30), 60)),
      p_offset => 0,
      p_include_upcoming => true,
      p_store_slug => null,
      p_min_price => null,
      p_max_price => null,
      p_only_images => false,
      p_sort => 'recommended',
      p_query => rec.search_text,
      p_filter_group => null,
      p_region_code => null,
      p_city_name => null,
      p_mode => 'all'
    ) with ordinality as page_row(offer, total_count, candidate_ord)
    order by page_row.candidate_ord;

    if not found then
      query_text := rec.query_text;
      query_key := lower(btrim(regexp_replace(public.unaccent(rec.query_text), '[^a-zA-Z0-9]+', ' ', 'g')));
      candidate_rank := null;
      offer := null;
      total_count := 0;
      return next;
    end if;
  end loop;
end;
$function$;

DO $test$
DECLARE
  v_pattern constant text := '[[:space:]]*\([[:space:]]*[0-9]+([.,][0-9]+)?[[:space:]]+(kg|g|ml|l|ks|balení|stroužky)[[:space:]]*\)[[:space:]]*$';
BEGIN
  IF btrim(regexp_replace('Hovězí maso (800 g)', v_pattern, '', 'i')) <> 'Hovězí maso' THEN
    RAISE EXCEPTION 'Regression: gram suffix was not stripped';
  END IF;
  IF btrim(regexp_replace('Kuřecí prsa (1 kg)', v_pattern, '', 'i')) <> 'Kuřecí prsa' THEN
    RAISE EXCEPTION 'Regression: kilogram suffix was not stripped';
  END IF;
  IF btrim(regexp_replace('Mléko (500 ml)', v_pattern, '', 'i')) <> 'Mléko' THEN
    RAISE EXCEPTION 'Regression: millilitre suffix was not stripped';
  END IF;
  IF btrim(regexp_replace('Olej (1 l)', v_pattern, '', 'i')) <> 'Olej' THEN
    RAISE EXCEPTION 'Regression: litre suffix was not stripped';
  END IF;
  IF btrim(regexp_replace('Vejce (10 ks)', v_pattern, '', 'i')) <> 'Vejce' THEN
    RAISE EXCEPTION 'Regression: piece suffix was not stripped';
  END IF;
  IF btrim(regexp_replace('Těstoviny (1 balení)', v_pattern, '', 'i')) <> 'Těstoviny' THEN
    RAISE EXCEPTION 'Regression: package suffix was not stripped';
  END IF;
  IF btrim(regexp_replace('Česnek (2 stroužky)', v_pattern, '', 'i')) <> 'Česnek' THEN
    RAISE EXCEPTION 'Regression: clove suffix was not stripped';
  END IF;
  IF btrim(regexp_replace('Rajčata (cherry)', v_pattern, '', 'i')) <> 'Rajčata (cherry)' THEN
    RAISE EXCEPTION 'Regression: semantic parentheses must be preserved';
  END IF;
END;
$test$;

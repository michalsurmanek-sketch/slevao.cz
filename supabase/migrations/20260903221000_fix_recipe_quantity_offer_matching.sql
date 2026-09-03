-- Keep recipe quantities visible to the user, but do not let a trailing
-- quantity annotation reduce recall when matching shopping-list items to offers.
--
-- Example:
--   query_text  = 'Hovězí maso (800 g)'  -- preserved for the frontend
--   search_text = 'Hovězí maso'          -- used only for offer matching
--
-- This definition intentionally matches the verified production function.

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
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT
      q.query_text,
      COALESCE(
        NULLIF(
          btrim(regexp_replace(
            q.query_text,
            '[[:space:]]*\([[:space:]]*[0-9]+([.,][0-9]+)?[[:space:]]+(kg|g|ml|l|ks|balení|stroužky)[[:space:]]*\)[[:space:]]*$',
            '',
            'i'
          )),
          ''
        ),
        q.query_text
      ) AS search_text,
      q.query_ord
    FROM (
      SELECT btrim(value) AS query_text, ordinality AS query_ord
      FROM unnest(COALESCE(p_queries, ARRAY[]::text[])) WITH ORDINALITY AS u(value, ordinality)
    ) q
    WHERE q.query_text <> ''
    ORDER BY q.query_ord
  LOOP
    RETURN QUERY
    SELECT
      rec.query_text,
      lower(btrim(regexp_replace(public.unaccent(rec.query_text), '[^a-zA-Z0-9]+', ' ', 'g'))) AS query_key,
      page_row.candidate_ord::integer,
      page_row.offer,
      page_row.total_count
    FROM public.get_public_offer_page_filtered(
      p_limit => greatest(1, least(COALESCE(p_limit_per_query, 30), 60)),
      p_offset => 0,
      p_include_upcoming => true,
      p_store_slug => NULL,
      p_min_price => NULL,
      p_max_price => NULL,
      p_only_images => false,
      p_sort => 'recommended',
      p_query => rec.search_text,
      p_filter_group => NULL,
      p_region_code => NULL,
      p_city_name => NULL,
      p_mode => 'all'
    ) WITH ORDINALITY AS page_row(offer, total_count, candidate_ord)
    ORDER BY page_row.candidate_ord;

    IF NOT FOUND THEN
      query_text := rec.query_text;
      query_key := lower(btrim(regexp_replace(public.unaccent(rec.query_text), '[^a-zA-Z0-9]+', ' ', 'g')));
      candidate_rank := NULL;
      offer := NULL;
      total_count := 0;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;

-- Keep recipe quantities visible in the shopping list while excluding the trailing
-- amount annotation from public offer search. This prevents strings such as
-- "Hovězí maso (800 g)" from hiding cheaper matches for "Hovězí maso".

create or replace function public.get_public_shopping_list_candidates(
  p_queries text[],
  p_limit_per_query integer default 30
)
returns table(
  query_text text,
  query_key text,
  candidate_rank integer,
  offer jsonb,
  total_count bigint
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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

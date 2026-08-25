-- Kaufland's official structured feed can legitimately contain an item below the
-- global 2 CZK public-offer floor. Keep the global quality barrier intact, but do
-- not let one such item abort the entire atomic Kaufland publication batch.
-- The original publisher stays unchanged behind this narrow service-only wrapper.

do $$
begin
  if to_regprocedure('public.apply_kaufland_official_offers_unfiltered_v1(uuid,uuid,text,jsonb)') is null then
    alter function public.apply_kaufland_official_offers(uuid, uuid, text, jsonb)
      rename to apply_kaufland_official_offers_unfiltered_v1;
  end if;
end
$$;

create or replace function public.apply_kaufland_official_offers(
  p_store_id uuid,
  p_import_id uuid,
  p_signature text,
  p_offers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
as $$
declare
  v_filtered jsonb;
  v_input_count integer;
  v_filtered_count integer;
  v_result jsonb;
begin
  if jsonb_typeof(p_offers) <> 'array' then
    raise exception 'Kaufland produkty nejsou JSON pole.';
  end if;

  v_input_count := jsonb_array_length(p_offers);

  select coalesce(jsonb_agg(item), '[]'::jsonb)
    into v_filtered
  from jsonb_array_elements(p_offers) as source(item)
  where coalesce(item ->> 'price', '') ~ '^[0-9]+(?:[.][0-9]+)?$'
    and (item ->> 'price')::numeric >= 2;

  v_filtered_count := jsonb_array_length(v_filtered);

  if v_filtered_count < 50 then
    raise exception 'Kaufland má po cenovém quality filtru pouze % z % produktů.',
      v_filtered_count, v_input_count;
  end if;

  -- The underlying publisher still enforces its own 90% completeness and all
  -- existing identity/atomicity guards. Only sub-2-CZK rows are removed here.
  v_result := public.apply_kaufland_official_offers_unfiltered_v1(
    p_store_id,
    p_import_id,
    p_signature,
    v_filtered
  );

  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'input_count', v_input_count,
    'price_floor', 2,
    'skipped_below_price_floor', v_input_count - v_filtered_count
  );
end;
$$;

revoke all on function public.apply_kaufland_official_offers_unfiltered_v1(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.apply_kaufland_official_offers(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_kaufland_official_offers(uuid, uuid, text, jsonb)
  to service_role;

create or replace function private.propagate_import_item_source_to_offer()
returns trigger
language plpgsql
set search_path = public, private
as $$
declare
  v_store_id uuid;
  v_valid_from date;
  v_valid_to date;
  v_document_url text;
  v_coverage_scope text;
  v_region_code text;
  v_city_name text;
  v_store_location_name text;
  v_source_url text;
  v_page integer;
  v_offer_id uuid;
  v_existing_offer_text text;
begin
  if new.status not in ('published','ignored') then return new; end if;

  select li.store_id, li.detected_valid_from, li.detected_valid_to,
         nullif(btrim(li.source_document_url), ''),
         coalesce(li.coverage_scope, 'national'), li.region_code, li.city_name, li.store_location_name
    into v_store_id, v_valid_from, v_valid_to, v_document_url,
         v_coverage_scope, v_region_code, v_city_name, v_store_location_name
  from public.leaflet_imports li where li.id = new.import_id;
  if v_store_id is null then return new; end if;

  v_source_url := coalesce(
    nullif(btrim(new.raw_data->>'product_url'), ''),
    nullif(btrim(new.raw_data->>'source_url'), ''),
    nullif(btrim(new.raw_data->>'page_url'), '')
  );

  v_page := new.source_page;
  if v_page is null and coalesce(new.raw_data->>'leaflet_page','') ~ '^[0-9]+$' then
    v_page := (new.raw_data->>'leaflet_page')::integer;
  elsif v_page is null and coalesce(new.raw_data->>'source_page','') ~ '^[0-9]+$' then
    v_page := (new.raw_data->>'source_page')::integer;
  elsif v_page is null and coalesce(new.raw_data->>'page','') ~ '^[0-9]+$' then
    v_page := (new.raw_data->>'page')::integer;
  end if;

  if v_source_url is null and v_document_url is not null then
    v_source_url := v_document_url;
    if v_page is not null and v_page > 0 then
      v_source_url := split_part(v_document_url, '#', 1) || '#page=' || v_page::text;
    end if;
  end if;
  if v_source_url is null then return new; end if;

  v_existing_offer_text := new.raw_data->>'existing_offer_id';
  if coalesce(v_existing_offer_text,'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_offer_id := v_existing_offer_text::uuid;
  end if;

  if v_offer_id is null and new.product_id is not null then
    select o.id into v_offer_id
    from public.offers o
    where o.store_id = v_store_id
      and o.product_id = new.product_id
      and o.status = 'published'
      and (v_valid_from is null or o.valid_from = v_valid_from)
      and (v_valid_to is null or o.valid_to = v_valid_to)
      and coalesce(o.coverage_scope,'national') = coalesce(v_coverage_scope,'national')
      and coalesce(o.region_code,'') = coalesce(v_region_code,'')
      and coalesce(o.city_name,'') = coalesce(v_city_name,'')
      and coalesce(o.store_location_name,'') = coalesce(v_store_location_name,'')
      and abs(o.price - new.price) < 0.01
    order by o.published_at desc nulls last, o.updated_at desc nulls last
    limit 1;
  end if;

  if v_offer_id is null then
    select o.id into v_offer_id
    from public.offers o
    where o.store_id = v_store_id
      and o.status = 'published'
      and lower(btrim(o.title)) = lower(btrim(new.title))
      and abs(o.price - new.price) < 0.01
      and (v_valid_from is null or o.valid_from = v_valid_from)
      and (v_valid_to is null or o.valid_to = v_valid_to)
      and coalesce(o.coverage_scope,'national') = coalesce(v_coverage_scope,'national')
      and coalesce(o.region_code,'') = coalesce(v_region_code,'')
      and coalesce(o.city_name,'') = coalesce(v_city_name,'')
      and coalesce(o.store_location_name,'') = coalesce(v_store_location_name,'')
    order by o.published_at desc nulls last, o.updated_at desc nulls last
    limit 1;
  end if;

  if v_offer_id is null then return new; end if;

  update public.offers o
  set source_url = case when coalesce(btrim(o.source_url),'') = '' then v_source_url else o.source_url end,
      metadata = coalesce(o.metadata,'{}'::jsonb)
        || jsonb_strip_nulls(jsonb_build_object(
          'import_id', new.import_id,
          'leaflet_page', v_page,
          'source_propagated_from_import_item', true
        )),
      updated_at = now()
  where o.id = v_offer_id;

  return new;
end;
$$;

revoke all on function private.propagate_import_item_source_to_offer() from public, anon, authenticated;

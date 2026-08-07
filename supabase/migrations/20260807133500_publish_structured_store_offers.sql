create or replace function public.publish_structured_store_offers(
  p_store_slug text,
  p_adapter text,
  p_signature text,
  p_rows jsonb,
  p_min_products integer default 1,
  p_max_products integer default 5000,
  p_source_document_url text default null,
  p_parser_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = '180s'
as $$
declare
  v_store_id uuid;
  v_store_name text;
  v_source_id uuid;
  v_import_id uuid;
  v_existing_import uuid;
  v_row jsonb;
  v_product_id uuid;
  v_offer_id uuid;
  v_offer_ids uuid[] := array[]::uuid[];
  v_input_count integer := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
  v_published integer := 0;
  v_expired integer := 0;
  v_skipped integer := 0;
  v_matched integer := 0;
  v_from date;
  v_to date;
  v_title text;
  v_norm text;
  v_qty text;
  v_price numeric;
  v_old_price numeric;
  v_external text;
  v_source_url text;
  v_image text;
  v_conf numeric;
  v_source_page integer;
  v_now timestamptz := now();
  v_parser text := coalesce(nullif(trim(p_parser_version), ''), p_adapter);
begin
  p_store_slug := lower(trim(coalesce(p_store_slug, '')));
  p_adapter := trim(coalesce(p_adapter, ''));

  if p_store_slug = '' then raise exception 'Chybí slug obchodu.'; end if;
  if p_adapter = '' or length(p_adapter) > 120 then raise exception 'Adapter je neplatný.'; end if;
  if coalesce(length(p_signature), 0) < 16 or length(p_signature) > 256 then raise exception 'Podpis zdroje je neplatný.'; end if;
  if p_min_products < 1 or p_max_products < p_min_products or p_max_products > 10000 then raise exception 'Bezpečnostní rozsah produktů je neplatný.'; end if;
  if v_input_count < p_min_products then raise exception '% parser našel jen % nabídek; minimum je %.', p_store_slug, v_input_count, p_min_products; end if;
  if v_input_count > p_max_products then raise exception '% parser našel podezřele mnoho nabídek: %.', p_store_slug, v_input_count; end if;

  select id, name into v_store_id, v_store_name from public.stores where slug = p_store_slug;
  if v_store_id is null then raise exception 'Obchod % nebyl nalezen.', p_store_slug; end if;

  select id into v_source_id
  from public.leaflet_sources
  where store_id = v_store_id and is_active = true
  order by last_success_at desc nulls last, created_at
  limit 1;
  if v_source_id is null then raise exception 'Obchod % nemá aktivní zdroj.', p_store_slug; end if;

  select id into v_existing_import
  from public.leaflet_imports
  where source_hash = p_adapter || ':' || p_signature
  limit 1;

  if v_existing_import is null then
    insert into public.leaflet_imports(
      source_id, store_id, source_document_url, source_hash, status, product_count,
      confidence, coverage_scope, detected_valid_from, detected_valid_to, started_at, metadata
    ) values (
      v_source_id, v_store_id, coalesce(p_source_document_url, ''), p_adapter || ':' || p_signature,
      'processing', 0, 0.95, 'national', current_date, current_date, v_now,
      jsonb_build_object('adapter', p_adapter, 'source_signature', p_signature, 'automatic', true, 'parser_version', v_parser)
    ) returning id into v_import_id;
  else
    v_import_id := v_existing_import;
    delete from public.leaflet_import_items where import_id = v_import_id;
    update public.leaflet_imports
      set status = 'processing', error_message = null, started_at = v_now, finished_at = null,
          source_document_url = coalesce(p_source_document_url, source_document_url), updated_at = v_now
    where id = v_import_id;
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_title := trim(coalesce(v_row->>'title', ''));
    v_norm := trim(coalesce(v_row->>'normalized_title', ''));
    v_qty := nullif(trim(coalesce(v_row->>'quantity_text', '')), '');
    v_price := nullif(v_row->>'price', '')::numeric;
    v_old_price := nullif(v_row->>'old_price', '')::numeric;
    v_external := trim(coalesce(v_row->>'external_id', ''));
    v_source_url := nullif(trim(coalesce(v_row->>'source_url', '')), '');
    v_image := nullif(trim(coalesce(v_row->>'image_url', '')), '');
    v_conf := coalesce(nullif(v_row->>'confidence', '')::numeric, 0.95);
    v_from := nullif(v_row->>'valid_from', '')::date;
    v_to := nullif(v_row->>'valid_to', '')::date;
    v_product_id := nullif(v_row->>'product_id', '')::uuid;
    v_source_page := nullif(v_row->>'source_page', '')::integer;

    if v_title = '' or v_norm = '' or v_external = '' or coalesce(v_price, 0) <= 0 or v_price > 100000
       or v_from is null or v_to is null or v_from > v_to then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    if v_old_price is not null and v_old_price <= v_price then v_old_price := null; end if;
    if v_conf < 0.50 or v_conf > 1 then v_conf := greatest(0.50, least(1, v_conf)); end if;

    if v_product_id is not null and not exists(select 1 from public.products where id = v_product_id) then v_product_id := null; end if;
    if v_product_id is null then
      select p.id into v_product_id
      from public.products p
      where coalesce(p.normalized_name, trim(lower(regexp_replace(p.name, '[^[:alnum:]á-žÁ-Ž]+', ' ', 'g')))) = v_norm
      order by p.is_verified desc, p.created_at
      limit 1;
    else
      v_matched := v_matched + 1;
    end if;

    if v_product_id is null then
      begin
        insert into public.products(name, normalized_name, quantity_text, image_url, is_verified, metadata)
        values(v_title, v_norm, v_qty, v_image, false,
          jsonb_build_object('created_from_structured_store_import', true, 'source_store_slug', p_store_slug, 'adapter', p_adapter, 'created_at', v_now))
        returning id into v_product_id;
      exception when unique_violation then
        select p.id into v_product_id
        from public.products p
        where coalesce(p.normalized_name, trim(lower(regexp_replace(p.name, '[^[:alnum:]á-žÁ-Ž]+', ' ', 'g')))) = v_norm
        order by p.created_at
        limit 1;
      end;
    end if;
    if v_product_id is null then raise exception 'Produkt % se nepodařilo uložit.', v_title; end if;

    if not exists(select 1 from public.product_aliases where product_id = v_product_id and normalized_alias = v_norm) then
      begin
        insert into public.product_aliases(product_id, alias, normalized_alias, quantity_text, source_store_id, confidence)
        values(v_product_id, v_title, v_norm, v_qty, v_store_id, v_conf);
      exception when unique_violation then null;
      end;
    end if;
    if v_image is null then select image_url into v_image from public.products where id = v_product_id; end if;

    v_offer_id := null;
    select o.id into v_offer_id
    from public.offers o
    where o.store_id = v_store_id
      and (
        o.external_id = v_external
        or (
          lower(btrim(o.title)) = lower(btrim(v_title))
          and o.valid_from = v_from and o.valid_to = v_to
          and o.coverage_scope = 'national'
          and coalesce(o.region_code, '') = '' and coalesce(o.city_name, '') = '' and coalesce(o.store_location_name, '') = ''
        )
      )
    order by case when o.external_id = v_external then 0 when o.status = 'published' then 1 else 2 end, o.created_at
    limit 1;

    if v_offer_id is null then
      insert into public.offers(
        product_id, store_id, title, normalized_title, image_url, source_url, external_id,
        price, old_price, valid_from, valid_to, status, is_verified, confidence_score,
        coverage_scope, metadata, published_at
      ) values (
        v_product_id, v_store_id, v_title, v_norm, v_image, v_source_url, v_external,
        v_price, v_old_price, v_from, v_to, 'published', v_conf >= 0.9, v_conf,
        'national', coalesce(v_row->'metadata', '{}'::jsonb) || jsonb_build_object('adapter', p_adapter, 'source_signature', p_signature, 'import_id', v_import_id), v_now
      ) returning id into v_offer_id;
    else
      update public.offers set
        product_id = v_product_id, title = v_title, normalized_title = v_norm,
        image_url = coalesce(v_image, image_url), source_url = v_source_url, external_id = v_external,
        price = v_price, old_price = v_old_price, valid_from = v_from, valid_to = v_to,
        status = 'published', is_verified = v_conf >= 0.9, confidence_score = v_conf,
        coverage_scope = 'national', region_code = null, city_name = null, store_location_name = null,
        metadata = coalesce(v_row->'metadata', '{}'::jsonb) || jsonb_build_object('adapter', p_adapter, 'source_signature', p_signature, 'import_id', v_import_id),
        published_at = v_now, updated_at = v_now
      where id = v_offer_id;
    end if;

    v_offer_ids := array_append(v_offer_ids, v_offer_id);
    v_published := v_published + 1;
    insert into public.leaflet_import_items(import_id, title, quantity_text, price, old_price, image_url, source_page, confidence, status, raw_data)
    values(v_import_id, v_title, v_qty, v_price, v_old_price, v_image, v_source_page, v_conf, 'published',
      coalesce(v_row->'metadata', '{}'::jsonb) || jsonb_build_object('offer_id', v_offer_id, 'external_id', v_external));
  end loop;

  if v_published < p_min_products then
    raise exception 'Po bezpečnostních filtrech zůstalo jen % nabídek pro %; předchozí sada zůstává zachovaná.', v_published, p_store_slug;
  end if;

  with expired as (
    update public.offers
      set status = 'expired', updated_at = v_now
    where store_id = v_store_id and status = 'published' and not(id = any(v_offer_ids))
    returning id
  ) select count(*) into v_expired from expired;

  select min((x->>'valid_from')::date), max((x->>'valid_to')::date)
    into v_from, v_to from jsonb_array_elements(p_rows) x;

  update public.leaflet_imports set
    status = 'published', product_count = v_published, confidence = 0.95,
    detected_valid_from = v_from, detected_valid_to = v_to, error_message = null,
    finished_at = v_now,
    metadata = jsonb_build_object(
      'adapter', p_adapter, 'source_signature', p_signature, 'automatic', true,
      'parser_version', v_parser, 'matched_catalog_products', v_matched,
      'published_products', v_published, 'skipped_products', v_skipped
    ), updated_at = v_now
  where id = v_import_id;

  update public.leaflet_imports
    set status = 'ignored', updated_at = v_now
  where store_id = v_store_id and id <> v_import_id and status = 'published' and metadata->>'adapter' = p_adapter;

  insert into public.store_product_sync_state(
    store_id,last_run_at,last_success_at,last_source_signature,source_fingerprint,product_set_hash,
    last_offer_count,expected_offer_count,last_published_count,last_valid_from,last_valid_to,
    parser_version,adapter_name,adapter_version,source_type,source_category,last_error,last_parser_error,
    health_status,health_reason,is_running,run_started_at,updated_at,last_import_id
  ) values (
    v_store_id,v_now,v_now,p_signature,p_signature,p_signature,
    v_published,v_published,v_published,v_from,v_to,
    v_parser,p_adapter,v_parser,'official-structured','current-leaflet',null,null,
    'ok',format('Automaticky publikováno %s nabídek %s.',v_published,v_store_name),false,null,v_now,v_import_id
  )
  on conflict(store_id) do update set
    last_run_at=excluded.last_run_at,last_success_at=excluded.last_success_at,
    last_source_signature=excluded.last_source_signature,source_fingerprint=excluded.source_fingerprint,
    product_set_hash=excluded.product_set_hash,last_offer_count=excluded.last_offer_count,
    expected_offer_count=excluded.expected_offer_count,last_published_count=excluded.last_published_count,
    last_valid_from=excluded.last_valid_from,last_valid_to=excluded.last_valid_to,
    parser_version=excluded.parser_version,adapter_name=excluded.adapter_name,adapter_version=excluded.adapter_version,
    source_type=excluded.source_type,source_category=excluded.source_category,
    last_error=null,last_parser_error=null,health_status='ok',health_reason=excluded.health_reason,
    is_running=false,run_started_at=null,updated_at=v_now,last_import_id=v_import_id;

  update public.leaflet_sources set
    last_checked_at=v_now,last_success_at=v_now,last_error=null,
    last_strategy_used='official_structured_products',last_strategy_success_at=v_now
  where id=v_source_id;

  return jsonb_build_object(
    'ok',true,'store_slug',p_store_slug,'import_id',v_import_id,'input',v_input_count,
    'published',v_published,'skipped',v_skipped,'expired',v_expired,
    'matched_catalog_products',v_matched,'signature',p_signature
  );
end;
$$;

revoke all on function public.publish_structured_store_offers(text,text,text,jsonb,integer,integer,text,text) from public, anon, authenticated;
grant execute on function public.publish_structured_store_offers(text,text,text,jsonb,integer,integer,text,text) to service_role;

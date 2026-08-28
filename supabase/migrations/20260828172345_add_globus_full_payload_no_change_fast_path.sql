alter function public.publish_globus_olomouc_offers(text,jsonb,text,text,integer,integer)
  set schema private;

alter function private.publish_globus_olomouc_offers(text,jsonb,text,text,integer,integer)
  rename to publish_globus_olomouc_offers_full;

revoke all on function private.publish_globus_olomouc_offers_full(text,jsonb,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function private.publish_globus_olomouc_offers_full(text,jsonb,text,text,integer,integer)
  to postgres;

create function public.publish_globus_olomouc_offers(
  p_signature text,
  p_rows jsonb,
  p_source_document_url text default 'https://www.globus.cz/olomouc/hypermarket/akcni-nabidka'::text,
  p_parser_version text default 'globus-action-products-api-v1'::text,
  p_reported_total_count integer default null::integer,
  p_accessible_product_count integer default null::integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
set statement_timeout = '180s'
as $$
declare
  v_result jsonb;
  v_store_id uuid;
  v_source_id uuid;
  v_import_id uuid;
  v_input integer;
  v_filtered_count integer;
  v_below_floor integer;
  v_scoped integer := 0;
  v_canonical_rows jsonb;
  v_payload_hash text;
  v_now timestamptz := clock_timestamp();
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'Globus rows must be a JSON array.';
  end if;

  v_input := jsonb_array_length(p_rows);
  if v_input < 300 or v_input > 1000 then
    raise exception 'Globus scoped snapshot has unsafe size: %.', v_input;
  end if;
  if p_accessible_product_count is not null and p_accessible_product_count <> v_input then
    raise exception 'Globus accessible count % does not match row count %.', p_accessible_product_count, v_input;
  end if;
  if p_reported_total_count is not null and p_reported_total_count < v_input then
    raise exception 'Globus reported total % is below accessible rows %.', p_reported_total_count, v_input;
  end if;
  if p_reported_total_count is not null and p_reported_total_count - v_input > 100 then
    raise exception 'Globus reported/accessibility gap is too large: % vs %.', p_reported_total_count, v_input;
  end if;

  select count(*)::integer
    into v_filtered_count
  from jsonb_array_elements(p_rows) as source(item)
  where coalesce(source.item ->> 'price', '') ~ '^[0-9]+(?:[.][0-9]+)?$'
    and (source.item ->> 'price')::numeric >= 2;

  v_below_floor := v_input - v_filtered_count;
  if v_filtered_count < 300 then
    raise exception 'Globus má po cenovém quality filtru pouze % z % produktů.', v_filtered_count, v_input;
  end if;

  select coalesce(
           jsonb_agg(source.item order by coalesce(source.item ->> 'external_id', ''), source.item::text),
           '[]'::jsonb
         )
    into v_canonical_rows
  from jsonb_array_elements(p_rows) as source(item);

  v_payload_hash := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'rows', v_canonical_rows,
          'source_document_url', p_source_document_url,
          'parser_version', p_parser_version,
          'reported_total_count', p_reported_total_count,
          'accessible_product_count', p_accessible_product_count
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select id into v_store_id
  from public.stores
  where slug = 'globus';
  if v_store_id is null then
    raise exception 'Globus store not found.';
  end if;

  select id into v_source_id
  from public.leaflet_sources
  where store_id = v_store_id
    and is_active = true
    and source_url = p_source_document_url
  limit 1;
  if v_source_id is null then
    raise exception 'Globus API source % is missing or inactive.', p_source_document_url;
  end if;

  select li.id
    into v_import_id
  from public.leaflet_imports li
  where li.store_id = v_store_id
    and li.source_id = v_source_id
    and li.status = 'published'
    and li.source_hash = 'globus-action-products-api-v1:' || p_signature
    and li.metadata ->> 'full_payload_hash_version' = 'globus-full-payload-v1'
    and li.metadata ->> 'full_payload_sha256' = v_payload_hash
  order by li.updated_at desc
  limit 1;

  if v_import_id is not null then
    select count(*)::integer
      into v_scoped
    from public.offers o
    where o.store_id = v_store_id
      and o.status = 'published'
      and o.metadata ->> 'adapter' = 'globus-action-products-api-v1'
      and o.metadata ->> 'source_signature' = p_signature
      and o.coverage_scope = 'city'
      and o.city_name = 'Olomouc';

    if v_scoped >= 300
       and exists (
         select 1
         from public.store_product_sync_state ss
         where ss.store_id = v_store_id
       ) then
      update public.leaflet_imports
         set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
               'full_payload_hash_version', 'globus-full-payload-v1',
               'full_payload_sha256', v_payload_hash,
               'api_reported_total_count', p_reported_total_count,
               'api_validated_product_count', v_input,
               'api_publishable_product_count', v_filtered_count,
               'skipped_below_price_floor', v_below_floor,
               'no_change_fast_path_at', v_now
             ),
             updated_at = v_now
       where id = v_import_id;

      update public.leaflet_sources
         set name = 'Globus Olomouc – akční nabídka API',
             source_url = p_source_document_url,
             source_type = 'api',
             adapter_key = 'globus-action-products-api-v1',
             extraction_strategy = 'structured_api',
             last_checked_at = v_now,
             last_success_at = v_now,
             last_error = null,
             last_strategy_used = 'official_structured_products',
             last_strategy_success_at = v_now,
             updated_at = v_now
       where id = v_source_id;

      update public.store_product_sync_state
         set last_run_at = v_now,
             last_success_at = v_now,
             last_source_signature = p_signature,
             source_fingerprint = p_signature,
             product_set_hash = p_signature,
             last_offer_count = v_scoped,
             expected_offer_count = v_filtered_count,
             last_published_count = v_scoped,
             parser_version = p_parser_version,
             adapter_name = 'globus-action-products-api-v1',
             adapter_version = p_parser_version,
             source_type = 'official-structured-api',
             source_category = 'branch-action-offer',
             last_error = null,
             last_parser_error = null,
             health_status = 'ok',
             health_reason = format(
               'Globus Olomouc: beze změn, ponecháno %s oficiálních API nabídek; API reportuje %s; pod 2 Kč vynecháno %s.',
               v_scoped,
               coalesce(p_reported_total_count, v_input),
               v_below_floor
             ),
             is_running = false,
             run_started_at = null,
             updated_at = v_now,
             last_import_id = v_import_id
       where store_id = v_store_id;

      return jsonb_build_object(
        'ok', true,
        'no_changes', true,
        'store_slug', 'globus',
        'import_id', v_import_id,
        'input', v_input,
        'published', v_scoped,
        'skipped', v_below_floor,
        'expired', 0,
        'signature', p_signature,
        'full_payload_sha256', v_payload_hash,
        'coverage_scope', 'city',
        'city_name', 'Olomouc',
        'store_location_name', 'Globus Olomouc',
        'house_number', 4008,
        'source_id', v_source_id,
        'scoped_offers', v_scoped,
        'reported_total_count', p_reported_total_count,
        'validated_product_count', v_input,
        'publishable_product_count', v_filtered_count,
        'price_floor', 2,
        'skipped_below_price_floor', v_below_floor
      );
    end if;
  end if;

  v_result := private.publish_globus_olomouc_offers_full(
    p_signature,
    p_rows,
    p_source_document_url,
    p_parser_version,
    p_reported_total_count,
    p_accessible_product_count
  );

  v_import_id := nullif(v_result ->> 'import_id', '')::uuid;
  if v_import_id is not null then
    update public.leaflet_imports
       set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
             'full_payload_hash_version', 'globus-full-payload-v1',
             'full_payload_sha256', v_payload_hash
           ),
           updated_at = clock_timestamp()
     where id = v_import_id;
  end if;

  return v_result || jsonb_build_object(
    'no_changes', false,
    'full_payload_sha256', v_payload_hash
  );
end;
$$;

revoke all on function public.publish_globus_olomouc_offers(text,jsonb,text,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.publish_globus_olomouc_offers(text,jsonb,text,text,integer,integer)
  to postgres, service_role;

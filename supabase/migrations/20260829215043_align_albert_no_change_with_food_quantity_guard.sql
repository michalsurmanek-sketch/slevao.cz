create or replace function public.publish_albert_publitas_text_offers_v4_strong(p_signature text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
set statement_timeout to '180s'
as $function$
declare
  v_result jsonb;
  v_store_id uuid;
  v_source_id uuid;
  v_import_id uuid;
  v_filtered jsonb;
  v_canonical_rows jsonb;
  v_payload_hash text;
  v_raw_count integer;
  v_count integer;
  v_variant_only_dropped integer;
  v_semantic_quantity_dropped integer;
  v_import_product_count integer;
  v_live_count integer := 0;
  v_matched integer := 0;
  v_created integer := 0;
  v_skipped integer := 0;
  v_from date;
  v_to date;
  v_effective_signature text;
  v_now timestamptz := clock_timestamp();
begin
  if jsonb_typeof(coalesce(p_rows,'[]'::jsonb)) <> 'array' then
    raise exception 'Albert strong rows must be a JSON array.';
  end if;
  if coalesce(length(p_signature),0) < 16 then
    raise exception 'Albert v4 signature je neplatný.';
  end if;

  v_raw_count := jsonb_array_length(coalesce(p_rows,'[]'::jsonb));

  select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb)
    into v_filtered
  from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) with ordinality source(value, ordinality)
  where lower(coalesce(value ->> 'identity_strength',''))='strong'
    and not public.albert_variant_only_label(coalesce(value ->> 'title', value #>> '{metadata,raw_title}', ''))
    and not public.albert_invalid_food_quantity(
      coalesce(value ->> 'title', value #>> '{metadata,raw_title}', ''),
      value ->> 'quantity_text'
    );

  v_count := jsonb_array_length(v_filtered);

  select count(*)::integer
    into v_variant_only_dropped
  from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) value
  where lower(coalesce(value ->> 'identity_strength',''))='strong'
    and public.albert_variant_only_label(coalesce(value ->> 'title', value #>> '{metadata,raw_title}', ''));

  select count(*)::integer
    into v_semantic_quantity_dropped
  from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) value
  where lower(coalesce(value ->> 'identity_strength',''))='strong'
    and not public.albert_variant_only_label(coalesce(value ->> 'title', value #>> '{metadata,raw_title}', ''))
    and public.albert_invalid_food_quantity(
      coalesce(value ->> 'title', value #>> '{metadata,raw_title}', ''),
      value ->> 'quantity_text'
    );

  if v_count < 50 then
    raise exception 'Albert strong-identity sada po bezpečnostních filtrech obsahuje jen % nabídek; bezpečnostní minimum je 50.',v_count;
  end if;

  v_effective_signature := p_signature || ':strong-safe-v2';

  select coalesce(
           jsonb_agg(source.item order by coalesce(source.item->>'external_id',''), source.item::text),
           '[]'::jsonb
         )
    into v_canonical_rows
  from jsonb_array_elements(v_filtered) source(item);

  v_payload_hash := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'signature',p_signature,
          'strong_identity_guard','variant-only-v2+food-quantity-v1',
          'rows',v_canonical_rows
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select id into v_store_id
  from public.stores
  where slug='albert';
  if v_store_id is null then raise exception 'Albert obchod nebyl nalezen.'; end if;

  select id into v_source_id
  from public.leaflet_sources
  where store_id=v_store_id and is_active=true
  order by last_success_at desc nulls last,created_at
  limit 1;
  if v_source_id is null then raise exception 'Albert nemá aktivní zdroj.'; end if;

  select li.id,
         li.product_count,
         coalesce((li.metadata->>'matched_catalog_products')::integer,0),
         coalesce((li.metadata->>'created_products')::integer,0),
         coalesce((li.metadata->>'skipped_products')::integer,0)
    into v_import_id,v_import_product_count,v_matched,v_created,v_skipped
  from public.leaflet_imports li
  where li.store_id=v_store_id
    and li.source_id=v_source_id
    and li.status='published'
    and li.source_hash='albert-products-publitas-text-v4:'||v_effective_signature
    and li.metadata->>'adapter'='albert-products-publitas-text-v4'
    and li.metadata->>'full_payload_hash_version'='albert-strong-full-payload-v1'
    and li.metadata->>'full_payload_sha256'=v_payload_hash
  order by li.updated_at desc nulls last,li.created_at desc
  limit 1;

  if v_import_id is not null then
    select count(*)::integer
      into v_live_count
    from public.offers o
    where o.store_id=v_store_id
      and o.status='published'
      and o.metadata->>'adapter'='albert-products-publitas-text-v4'
      and o.metadata->>'source_signature'=v_effective_signature;

    if v_live_count=v_import_product_count
       and v_live_count>=50
       and exists(select 1 from public.store_product_sync_state ss where ss.store_id=v_store_id) then
      select min((x->>'valid_from')::date),max((x->>'valid_to')::date)
        into v_from,v_to
      from jsonb_array_elements(v_filtered) x;

      update public.leaflet_imports
         set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
               'full_payload_hash_version','albert-strong-full-payload-v1',
               'full_payload_sha256',v_payload_hash,
               'strong_identity_guard','variant-only-v2+food-quantity-v1',
               'semantic_quantity_dropped',v_semantic_quantity_dropped,
               'no_change_fast_path_at',v_now
             ),
             updated_at=v_now
       where id=v_import_id;

      update public.store_product_sync_state
         set last_run_at=v_now,
             last_success_at=v_now,
             last_source_signature=v_effective_signature,
             source_fingerprint=v_effective_signature,
             product_set_hash=v_effective_signature,
             last_offer_count=v_live_count,
             expected_offer_count=v_live_count,
             last_published_count=v_live_count,
             last_valid_from=v_from,
             last_valid_to=v_to,
             parser_version='albert-publitas-text-v4',
             adapter_name='sync-albert-products',
             adapter_version='albert-publitas-text-v4',
             source_type='official-publitas-text',
             source_category='current-leaflets',
             last_error=null,
             last_parser_error=null,
             health_status='ok',
             health_reason=format('Albert strong sada beze změny; zachováno %s ověřených nabídek.',v_live_count),
             is_running=false,
             run_started_at=null,
             updated_at=v_now,
             last_import_id=v_import_id
       where store_id=v_store_id;

      update public.leaflet_sources
         set last_checked_at=v_now,
             last_success_at=v_now,
             last_error=null,
             last_strategy_used='official_publitas_text_products_v4',
             last_strategy_success_at=v_now
       where id=v_source_id;

      return jsonb_build_object(
        'ok',true,
        'no_changes',true,
        'import_id',v_import_id,
        'input',v_count,
        'published',v_live_count,
        'skipped',v_skipped,
        'expired',0,
        'matched_catalog_products',v_matched,
        'created_products',v_created,
        'signature',v_effective_signature,
        'full_payload_sha256',v_payload_hash,
        'strong_identity_only',true,
        'strong_identity_guard','variant-only-v2+food-quantity-v1',
        'strong_input',v_count,
        'raw_input',v_raw_count,
        'variant_only_dropped',v_variant_only_dropped,
        'semantic_quantity_dropped',v_semantic_quantity_dropped
      );
    end if;
  end if;

  v_result := private.publish_albert_publitas_text_offers_v4_strong_full(p_signature,p_rows);
  v_import_id := nullif(v_result->>'import_id','')::uuid;

  if v_import_id is not null then
    update public.leaflet_imports
       set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'full_payload_hash_version','albert-strong-full-payload-v1',
             'full_payload_sha256',v_payload_hash,
             'strong_identity_guard','variant-only-v2+food-quantity-v1',
             'semantic_quantity_dropped',v_semantic_quantity_dropped
           ),
           updated_at=clock_timestamp()
     where id=v_import_id;
  end if;

  return coalesce(v_result,'{}'::jsonb)||jsonb_build_object(
    'no_changes',false,
    'full_payload_sha256',v_payload_hash,
    'strong_identity_guard','variant-only-v2+food-quantity-v1',
    'semantic_quantity_dropped',v_semantic_quantity_dropped
  );
end;
$function$;

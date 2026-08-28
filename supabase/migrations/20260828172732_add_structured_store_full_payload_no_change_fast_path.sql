alter function public.publish_structured_store_offers(text,text,text,jsonb,integer,integer,text,text)
  set schema private;

alter function private.publish_structured_store_offers(text,text,text,jsonb,integer,integer,text,text)
  rename to publish_structured_store_offers_full;

revoke all on function private.publish_structured_store_offers_full(text,text,text,jsonb,integer,integer,text,text)
  from public, anon, authenticated, service_role;
grant execute on function private.publish_structured_store_offers_full(text,text,text,jsonb,integer,integer,text,text)
  to postgres;

create function public.publish_structured_store_offers(
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
set search_path = public, private, extensions, pg_temp
set statement_timeout = '180s'
as $$
declare
  v_result jsonb;
  v_store_id uuid;
  v_store_name text;
  v_source_id uuid;
  v_import_id uuid;
  v_import_product_count integer;
  v_input_count integer;
  v_live_count integer := 0;
  v_skipped integer := 0;
  v_matched integer := 0;
  v_from date;
  v_to date;
  v_parser text;
  v_canonical_rows jsonb;
  v_payload_hash text;
  v_now timestamptz := clock_timestamp();
begin
  p_store_slug := lower(trim(coalesce(p_store_slug,'')));
  p_adapter := trim(coalesce(p_adapter,''));
  v_parser := coalesce(nullif(trim(p_parser_version),''),p_adapter);

  if p_store_slug='' then raise exception 'Chybí slug obchodu.'; end if;
  if p_adapter='' or length(p_adapter)>120 then raise exception 'Adapter je neplatný.'; end if;
  if coalesce(length(p_signature),0)<16 or length(p_signature)>256 then raise exception 'Podpis zdroje je neplatný.'; end if;
  if p_min_products<1 or p_max_products<p_min_products or p_max_products>10000 then raise exception 'Bezpečnostní rozsah produktů je neplatný.'; end if;
  if jsonb_typeof(coalesce(p_rows,'[]'::jsonb)) <> 'array' then raise exception 'Structured rows must be a JSON array.'; end if;

  v_input_count := jsonb_array_length(p_rows);
  if v_input_count<p_min_products then raise exception '% parser našel jen % nabídek; minimum je %.',p_store_slug,v_input_count,p_min_products; end if;
  if v_input_count>p_max_products then raise exception '% parser našel podezřele mnoho nabídek: %.',p_store_slug,v_input_count; end if;

  select id,name into v_store_id,v_store_name
  from public.stores
  where slug=p_store_slug;
  if v_store_id is null then raise exception 'Obchod % nebyl nalezen.',p_store_slug; end if;

  select id into v_source_id
  from public.leaflet_sources
  where store_id=v_store_id and is_active=true
  order by last_success_at desc nulls last,created_at
  limit 1;
  if v_source_id is null then raise exception 'Obchod % nemá aktivní zdroj.',p_store_slug; end if;

  select coalesce(
           jsonb_agg(source.item order by coalesce(source.item->>'external_id',''), source.item::text),
           '[]'::jsonb
         )
    into v_canonical_rows
  from jsonb_array_elements(p_rows) source(item);

  v_payload_hash := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'store_slug', p_store_slug,
          'adapter', p_adapter,
          'signature', p_signature,
          'rows', v_canonical_rows,
          'min_products', p_min_products,
 'max_products', p_max_products,
          'source_document_url', p_source_document_url,
          'parser_version', v_parser
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select li.id,
         li.product_count,
         coalesce((li.metadata->>'skipped_products')::integer,0),
         coalesce((li.metadata->>'matched_catalog_products')::integer,0)
    into v_import_id,v_import_product_count,v_skipped,v_matched
  from public.leaflet_imports li
  where li.store_id=v_store_id
    and li.source_id=v_source_id
    and li.status='published'
    and li.source_hash=p_adapter||':'||p_signature
    and li.metadata->>'adapter'=p_adapter
    and li.metadata->>'full_payload_hash_version'='structured-full-payload-v1'
    and li.metadata->>'full_payload_sha256'=v_payload_hash
  order by li.updated_at desc nulls last,li.created_at desc
  limit 1;

  if v_import_id is not null then
    select count(*)::integer
      into v_live_count
    from public.offers o
    where o.store_id=v_store_id
      and o.status='published'
      and o.metadata->>'adapter'=p_adapter
      and o.metadata->>'source_signature'=p_signature;

    if v_live_count=v_import_product_count
       and v_live_count>=p_min_products
       and exists (
         select 1 from public.store_product_sync_state ss where ss.store_id=v_store_id
       ) then
      select min((x->>'valid_from')::date),max((x->>'valid_to')::date)
        into v_from,v_to
      from jsonb_array_elements(p_rows) x;

      update public.leaflet_imports
         set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
               'full_payload_hash_version','structured-full-payload-v1',
               'full_payload_sha256',v_payload_hash,
               'no_change_fast_path_at',v_now
             ),
             updated_at=v_now
       where id=v_import_id;

      update public.store_product_sync_state
         set last_run_at=v_now,
             last_success_at=v_now,
             last_source_signature=p_signature,
             source_fingerprint=p_signature,
             product_set_hash=p_signature,
             last_offer_count=v_live_count,
             expected_offer_count=v_live_count,
             last_published_count=v_live_count,
             last_valid_from=v_from,
             last_valid_to=v_to,
             parser_version=v_parser,
             adapter_name=p_adapter,
             adapter_version=v_parser,
             source_type='official-structured',
             source_category='current-leaflet',
             last_error=null,
             last_parser_error=null,
             health_status='ok',
             health_reason=format('Produktová sada %s beze změny; zachováno %s ověřených nabídek.',v_store_name,v_live_count),
             is_running=false,
             run_started_at=null,
             updated_at=v_now,
             last_import_id=v_import_id
       where store_id=v_store_id;

      update public.leaflet_sources
         set last_checked_at=v_now,
             last_success_at=v_now,
             last_error=null,
             last_strategy_used='official_structured_products',
             last_strategy_success_at=v_now
       where id=v_source_id;

      return jsonb_build_object(
        'ok',true,
        'no_changes',true,
        'store_slug',p_store_slug,
        'import_id',v_import_id,
        'input',v_input_count,
        'published',v_live_count,
        'skipped',v_skipped,
        'expired',0,
        'matched_catalog_products',v_matched,
        'signature',p_signature,
        'product_identity','structured-store-external-v2',
        'full_payload_sha256',v_payload_hash
      );
    end if;
  end if;

  v_result := private.publish_structured_store_offers_full(
    p_store_slug,
    p_adapter,
    p_signature,
    p_rows,
    p_min_products,
    p_max_products,
    p_source_document_url,
    p_parser_version
  );

  v_import_id := nullif(v_result->>'import_id','')::uuid;
  if v_import_id is not null then
    update public.leaflet_imports
       set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'full_payload_hash_version','structured-full-payload-v1',
             'full_payload_sha256',v_payload_hash
           ),
           updated_at=clock_timestamp()
     where id=v_import_id;
  end if;

  return v_result||jsonb_build_object('full_payload_sha256',v_payload_hash);
end;
$$;

revoke all on function public.publish_structured_store_offers(text,text,text,jsonb,integer,integer,text,text)
  from public, anon, authenticated;
grant execute on function public.publish_structured_store_offers(text,text,text,jsonb,integer,integer,text,text)
  to postgres, service_role;

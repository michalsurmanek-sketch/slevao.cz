alter function public.publish_coop_verified_markdown(text,bigint,text)
  set schema private;

alter function private.publish_coop_verified_markdown(text,bigint,text)
  rename to publish_coop_verified_markdown_full;

revoke all on function private.publish_coop_verified_markdown_full(text,bigint,text)
  from public, anon, authenticated, service_role;
grant execute on function private.publish_coop_verified_markdown_full(text,bigint,text)
  to postgres;

create function private.coop_verified_rows_match_published_set(
  p_rows jsonb,
  p_store_id uuid,
  p_signature text,
  p_pdf_url text,
  p_valid_from date,
  p_valid_to date,
  p_count integer
)
returns boolean
language sql
stable
set search_path = public, private, pg_temp
as $$
with expected as materialized (
  select
    'cooppdf:' || trim(coalesce(x->>'external_key','')) as external_id,
    trim(coalesce(x->>'normalized_title','')) as normalized_title,
    nullif(trim(coalesce(x->>'quantity_text','')),'') as quantity_text,
    nullif(x->>'price','')::numeric as price,
    nullif(x->>'unit_price','')::numeric as unit_price,
    nullif(x->>'valid_from','')::date as valid_from,
    nullif(x->>'valid_to','')::date as valid_to,
    coalesce(x->'metadata','{}'::jsonb) as metadata
  from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) x
), published_count as (
  select count(*)::integer as n
  from public.offers o
  where o.store_id=p_store_id
    and o.status='published'
    and o.external_id like 'cooppdf:%'
), exact_matches as (
  select count(*)::integer as n
  from expected e
  join public.offers o
    on o.store_id=p_store_id
   and o.status='published'
   and o.external_id=e.external_id
   and o.normalized_title=e.normalized_title
   and public.normalize_product_name(o.title)=e.normalized_title
   and o.source_url=p_pdf_url
   and o.price=e.price
   and o.old_price is null
   and o.unit_price is not distinct from e.unit_price
   and o.unit_price_unit is not distinct from case
         when coalesce(e.quantity_text,'') ilike '% ml' or coalesce(e.quantity_text,'') ilike '% l' then 'l'
         else 'kg'
       end
   and o.valid_from=p_valid_from
   and o.valid_to=p_valid_to
   and e.valid_from=p_valid_from
   and e.valid_to=p_valid_to
   and o.is_verified=true
   and o.confidence_score=0.99
   and o.coverage_scope='store'
   and o.store_location_name='Vybrané prodejny COOP'
   and o.region_code is null
   and o.city_name is null
   and coalesce(o.metadata->>'adapter','')=coalesce(e.metadata->>'adapter','')
   and coalesce(o.metadata->>'source_signature','')=p_signature
)
select jsonb_array_length(coalesce(p_rows,'[]'::jsonb))=p_count
   and coalesce((select n from published_count),0)=p_count
   and coalesce((select n from exact_matches),0)=p_count;
$$;

revoke all on function private.coop_verified_rows_match_published_set(jsonb,uuid,text,text,date,date,integer)
  from public, anon, authenticated, service_role;
grant execute on function private.coop_verified_rows_match_published_set(jsonb,uuid,text,text,date,date,integer)
  to postgres;

create function public.publish_coop_verified_markdown(
  p_markdown text,
  p_request_id bigint default null,
  p_pdf_url text default null
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
  v_count integer;
  v_import_product_count integer;
  v_signature text;
  v_from date;
  v_to date;
  v_canonical_rows jsonb;
  v_payload_hash text;
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_now timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended('slevao:coop-verified-markdown',0));

  if p_pdf_url is null or p_pdf_url not ilike 'https://www.coopclub.cz/%' or p_pdf_url not ilike '%.pdf' then
    raise exception 'COOP: neočekávaný PDF zdroj.';
  end if;

  select id into v_store_id from public.stores where slug='coop';
  if v_store_id is null then raise exception 'COOP obchod nebyl nalezen.'; end if;

  select id into v_source_id
  from public.leaflet_sources
  where store_id=v_store_id and is_active=true
  order by last_success_at desc nulls last,created_at
  limit 1;
  if v_source_id is null then raise exception 'COOP nemá aktivní zdroj.'; end if;

  select
    count(*)::integer,
    min(r.valid_from),
    max(r.valid_to),
    md5(string_agg(r.external_key||'|'||r.price::text,E'\n' order by r.external_key)),
    coalesce(
      jsonb_agg(to_jsonb(r) order by r.external_key,r.title,r.quantity_text,r.price,r.unit_price,r.valid_from,r.valid_to),
      '[]'::jsonb
    )
  into v_count,v_from,v_to,v_signature,v_canonical_rows
  from public.parse_coop_verified_markdown(p_markdown) r;

  if v_count<12 then raise exception 'COOP bezpečný parser našel jen % produktů.',v_count; end if;
  if v_count>150 then raise exception 'COOP bezpečný parser našel podezřele mnoho produktů: %.',v_count; end if;
  if v_from is null or v_to is null or v_from>v_to or not(v_from<=v_today and v_to>=v_today) then
    raise exception 'COOP dokument není aktuální: % až %.',v_from,v_to;
  end if;

  v_payload_hash := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'publisher_contract','coop-verified-full-payload-v1',
          'parser_contract','coop-verified-pdf-text-v1',
          'signature',v_signature,
          'valid_from',v_from,
          'valid_to',v_to,
          'pdf_url',p_pdf_url,
          'coverage_scope','store',
          'store_location_name','Vybrané prodejny COOP',
          'rows',v_canonical_rows
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select li.id,li.product_count
    into v_import_id,v_import_product_count
  from public.leaflet_imports li
  where li.store_id=v_store_id
    and li.source_id=v_source_id
    and li.status='published'
    and li.source_hash='coop-verified-pdf-text-v1:'||v_signature
    and li.metadata->>'adapter'='coop-verified-pdf-text-v1'
    and li.metadata->>'full_payload_hash_version'='coop-verified-full-payload-v1'
    and li.metadata->>'full_payload_sha256'=v_payload_hash
  order by li.updated_at desc nulls last,li.created_at desc
  limit 1;

  if v_import_id is not null
     and v_import_product_count=v_count
     and exists(select 1 from public.store_product_sync_state ss where ss.store_id=v_store_id)
     and private.coop_verified_rows_match_published_set(
       v_canonical_rows,v_store_id,v_signature,p_pdf_url,v_from,v_to,v_count
     ) then
    update public.leaflet_imports
       set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'full_payload_hash_version','coop-verified-full-payload-v1',
             'full_payload_sha256',v_payload_hash,
             'no_change_fast_path_at',v_now
           ),
           updated_at=v_now
     where id=v_import_id;

    update public.store_product_sync_state
       set last_run_at=v_now,
           last_success_at=v_now,
           last_source_signature=v_signature,
           last_offer_count=v_count,
           last_error=null,
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'request_id',p_request_id,
             'partial_coverage',true,
             'selected_stores_only',true,
             'no_changes',true,
             'full_payload_sha256',v_payload_hash
           ),
           updated_at=v_now,
           last_valid_from=v_from,
           last_valid_to=v_to,
           is_running=false,
           run_started_at=null,
           parser_version='coop-verified-pdf-text-v1',
           source_type='official-pdf-text',
           expected_offer_count=v_count,
           coverage_scope='store',
           source_category='current-offers',
           last_http_status=200,
           last_html_length=length(p_markdown),
           last_parser_error=null,
           last_product_candidates=v_count,
           last_published_count=v_count,
           last_import_id=v_import_id,
           adapter_name='coop-pdf-text',
           adapter_version='coop-verified-pdf-text-v1',
           source_fingerprint=v_signature,
           health_reason=format('COOP: ověřená PDF sada beze změny; zachováno %s matematicky ověřených cen pro vybrané prodejny.',v_count),
           health_status='degraded',
           product_set_hash=v_signature
     where store_id=v_store_id;

    update public.leaflet_sources
       set last_checked_at=v_now,
           last_success_at=v_now,
           last_error=null,
           last_strategy_used='verified_official_pdf_text_partial',
           last_strategy_success_at=v_now
     where id=v_source_id;

    return jsonb_build_object(
      'ok',true,
      'no_changes',true,
      'import_id',v_import_id,
      'parsed',v_count,
      'published',v_count,
      'expired',0,
      'valid_from',v_from,
      'valid_to',v_to,
      'partial_coverage',true,
      'selected_stores_only',true,
      'signature',v_signature,
      'full_payload_sha256',v_payload_hash
    );
  end if;

  v_result := private.publish_coop_verified_markdown_full(p_markdown,p_request_id,p_pdf_url);

  v_import_id := nullif(v_result->>'import_id','')::uuid;
  if v_import_id is not null then
    update public.leaflet_imports
       set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'full_payload_hash_version','coop-verified-full-payload-v1',
             'full_payload_sha256',v_payload_hash
           ),
           updated_at=clock_timestamp()
     where id=v_import_id;
  end if;

  return coalesce(v_result,'{}'::jsonb)||jsonb_build_object(
    'no_changes',false,
    'signature',v_signature,
    'full_payload_sha256',v_payload_hash
  );
end;
$$;

revoke all on function public.publish_coop_verified_markdown(text,bigint,text)
  from public, anon, authenticated;
grant execute on function public.publish_coop_verified_markdown(text,bigint,text)
  to postgres, service_role;

do $$
declare
  v_import_id uuid;
  v_store_id uuid;
  v_source_document_url text;
  v_product_count integer;
  v_valid_from date;
  v_valid_to date;
  v_signature text;
  v_rows jsonb;
  v_row_count integer;
  v_payload_hash text;
begin
  select li.id,li.store_id,li.source_document_url,li.product_count,
         li.detected_valid_from,li.detected_valid_to,li.metadata->>'source_signature'
    into v_import_id,v_store_id,v_source_document_url,v_product_count,
         v_valid_from,v_valid_to,v_signature
  from public.leaflet_imports li
  join public.stores s on s.id=li.store_id
  where s.slug='coop'
    and li.status='published'
    and li.metadata->>'adapter'='coop-verified-pdf-text-v1'
    and li.source_hash='coop-verified-pdf-text-v1:'||(li.metadata->>'source_signature')
  order by li.updated_at desc nulls last,li.created_at desc
  limit 1;

  if v_import_id is not null and coalesce(v_signature,'')<>'' then
    select count(*)::integer,
           coalesce(jsonb_agg(
             jsonb_build_object(
               'external_key',substring(o.external_id from length('cooppdf:')+1),
               'title',lii.title,
               'normalized_title',o.normalized_title,
               'quantity_text',lii.quantity_text,
               'price',lii.price,
               'unit_price',o.unit_price,
               'valid_from',o.valid_from,
               'valid_to',o.valid_to,
               'metadata',coalesce(lii.raw_data,'{}'::jsonb)-'offer_id'
             )
             order by substring(o.external_id from length('cooppdf:')+1),lii.title,lii.quantity_text,lii.price,o.unit_price,o.valid_from,o.valid_to
           ),'[]'::jsonb)
      into v_row_count,v_rows
    from public.leaflet_import_items lii
    join public.offers o on o.id=nullif(lii.raw_data->>'offer_id','')::uuid
    where lii.import_id=v_import_id
      and o.store_id=v_store_id
      and o.status='published'
      and o.external_id like 'cooppdf:%';

    if v_row_count=v_product_count
       and private.coop_verified_rows_match_published_set(
         v_rows,v_store_id,v_signature,v_source_document_url,v_valid_from,v_valid_to,v_row_count
       ) then
      v_payload_hash := encode(
        extensions.digest(
          convert_to(
            jsonb_build_object(
              'publisher_contract','coop-verified-full-payload-v1',
              'parser_contract','coop-verified-pdf-text-v1',
              'signature',v_signature,
              'valid_from',v_valid_from,
              'valid_to',v_valid_to,
              'pdf_url',v_source_document_url,
              'coverage_scope','store',
              'store_location_name','Vybrané prodejny COOP',
              'rows',v_rows
            )::text,
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      );

      update public.leaflet_imports
         set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
               'full_payload_hash_version','coop-verified-full-payload-v1',
               'full_payload_sha256',v_payload_hash,
               'full_payload_backfilled_at',clock_timestamp()
             ),
             updated_at=clock_timestamp()
       where id=v_import_id;
    end if;
  end if;
end;
$$;
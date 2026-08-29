create or replace function public.trigger_lidl_verified_sync()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_store_id uuid;
  v_pdf text;
  v_from date;
  v_to date;
  v_request_id bigint;
  v_now timestamptz := now();
  v_today date := (now() at time zone 'Europe/Prague')::date;
begin
  select id into v_store_id from public.stores where slug='lidl';
  if v_store_id is null then
    return null;
  end if;

  select li.source_document_url, li.detected_valid_from, li.detected_valid_to
    into v_pdf, v_from, v_to
  from public.leaflet_imports li
  where li.store_id=v_store_id
    and li.detected_valid_to>=v_today
    and li.detected_valid_from<=v_today+4
    and li.source_document_url ilike 'https://assets.leaflets.schwarz/%Akcni-letak-OD-%'
  order by
    case when exists(
      select 1
      from public.leaflet_imports verified
      where verified.store_id=v_store_id
        and verified.status='published'
        and verified.source_document_url=li.source_document_url
        and verified.detected_valid_from=li.detected_valid_from
        and verified.detected_valid_to=li.detected_valid_to
        and verified.metadata->>'adapter'='lidl-verified-pdf-text-v1'
    ) then 1 else 0 end,
    case when li.detected_valid_from<=v_today and li.detected_valid_to>=v_today then 0 else 1 end,
    li.detected_valid_from,
    li.created_at desc
  limit 1;

  if v_pdf is null then
    update public.store_product_sync_state
      set health_status='waiting_source',
          last_error='Lidl: aktuální ani nejbližší budoucí hlavní PDF zatím není dostupné.',
          is_running=false,
          updated_at=v_now
    where store_id=v_store_id;
    return null;
  end if;

  if exists(
    select 1 from public.structured_retail_http_jobs
    where store_id=v_store_id
      and adapter='lidl-verified-pdf-text-v1'
      and status='pending'
      and requested_at>v_now-interval '20 minutes'
  ) then
    return null;
  end if;

  v_request_id:=net.http_get(
    url:='https://r.jina.ai/'||v_pdf,
    headers:=jsonb_build_object('User-Agent','Slevao/1.0','Accept','text/plain,text/markdown'),
    timeout_milliseconds:=30000
  );

  insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
  values(v_request_id,v_store_id,'lidl-verified-pdf-text-v1','pending',jsonb_build_object(
    'pdf_url',v_pdf,
    'valid_from',v_from,
    'valid_to',v_to,
    'upcoming_prefetch',v_from>v_today
  ));

  if v_from<=v_today and v_to>=v_today then
    update public.store_product_sync_state
      set last_run_at=v_now,
          is_running=true,
          run_started_at=v_now,
          health_status='running',
          last_error=null,
          updated_at=v_now
    where store_id=v_store_id;
  else
    update public.store_product_sync_state
      set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
            'upcoming_prefetch_requested_at',v_now,
            'upcoming_prefetch_valid_from',v_from,
            'upcoming_prefetch_valid_to',v_to,
            'upcoming_prefetch_request_id',v_request_id
          ),
          updated_at=v_now
    where store_id=v_store_id;
  end if;

  return v_request_id;
end;
$function$;

create or replace function public.publish_lidl_verified_markdown(p_markdown text, p_valid_from date, p_valid_to date, p_request_id bigint default null::bigint, p_pdf_url text default null::text)
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
  v_count integer;
  v_import_product_count integer;
  v_signature text;
  v_canonical_rows jsonb;
  v_payload_hash text;
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_is_current boolean;
  v_now timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended('slevao:lidl-verified-markdown',0));

  if p_pdf_url is null or p_pdf_url not ilike 'https://assets.leaflets.schwarz/%Akcni-letak-OD-%' then
    raise exception 'Lidl: neočekávaný zdrojový dokument.';
  end if;
  if p_valid_from is null or p_valid_to is null or p_valid_from>p_valid_to
     or p_valid_to<v_today or p_valid_from>v_today+4 then
    raise exception 'Lidl dokument není v bezpečném aktuálním/future horizontu: % až %.',p_valid_from,p_valid_to;
  end if;
  v_is_current := p_valid_from<=v_today and p_valid_to>=v_today;

  select id into v_store_id
  from public.stores
  where slug='lidl';
  if v_store_id is null then raise exception 'Lidl obchod nebyl nalezen.'; end if;

  select id into v_source_id
  from public.leaflet_sources
  where store_id=v_store_id and is_active=true
  order by last_success_at desc nulls last,created_at
  limit 1;
  if v_source_id is null then raise exception 'Lidl nemá aktivní zdroj.'; end if;

  select
    count(*)::integer,
    md5(string_agg(r.external_key||'|'||r.price::text,E'\n' order by r.external_key)),
    coalesce(
      jsonb_agg(to_jsonb(r) order by r.external_key,r.title,r.quantity_text,r.price,r.unit_price),
      '[]'::jsonb
    )
  into v_count,v_signature,v_canonical_rows
  from public.parse_lidl_verified_markdown(p_markdown,p_valid_from,p_valid_to) r;

  if v_count<8 then raise exception 'Lidl bezpečný parser našel jen % produktů.',v_count; end if;
  if v_count>150 then raise exception 'Lidl bezpečný parser našel podezřele mnoho produktů: %.',v_count; end if;

  v_payload_hash := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'publisher_contract','lidl-verified-full-payload-v1',
          'parser_contract','lidl-verified-pdf-text-v2',
          'signature',v_signature,
          'valid_from',p_valid_from,
          'valid_to',p_valid_to,
          'pdf_url',p_pdf_url,
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
    and li.source_hash='lidl-verified-pdf-text-v1:'||v_signature
    and li.metadata->>'adapter'='lidl-verified-pdf-text-v1'
    and li.metadata->>'full_payload_hash_version'='lidl-verified-full-payload-v1'
    and li.metadata->>'full_payload_sha256'=v_payload_hash
  order by li.updated_at desc nulls last,li.created_at desc
  limit 1;

  if v_import_id is not null
     and v_import_product_count=v_count
     and private.lidl_verified_rows_match_published_set(
       v_canonical_rows,v_store_id,v_signature,p_pdf_url,p_valid_from,p_valid_to,v_count
     ) then
    update public.leaflet_imports
       set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'full_payload_hash_version','lidl-verified-full-payload-v1',
             'full_payload_sha256',v_payload_hash,
             'upcoming_prefetch',not v_is_current,
             'no_change_fast_path_at',v_now
           ),
           updated_at=v_now
     where id=v_import_id;

    if v_is_current then
      update public.store_product_sync_state
         set last_run_at=v_now,
             last_success_at=v_now,
             last_source_signature=v_signature,
             last_offer_count=v_count,
             last_error=null,
             metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
               'request_id',p_request_id,
               'partial_coverage',true,
               'no_changes',true,
               'full_payload_sha256',v_payload_hash
             ),
             updated_at=v_now,
             last_valid_from=p_valid_from,
             last_valid_to=p_valid_to,
             is_running=false,
             run_started_at=null,
             parser_version='lidl-verified-pdf-text-v1',
             source_type='official-pdf-text',
             expected_offer_count=v_count,
             coverage_scope='national',
             source_category='current-offers',
             last_http_status=200,
             last_html_length=length(p_markdown),
             last_parser_error=null,
             last_product_candidates=v_count,
             last_published_count=v_count,
             last_import_id=v_import_id,
             adapter_name='lidl-pdf-text',
             adapter_version='lidl-verified-pdf-text-v1',
             source_fingerprint=v_signature,
             health_reason=format('Lidl: ověřená PDF sada beze změny; zachováno %s matematicky ověřených cen.',v_count),
             health_status='degraded',
             product_set_hash=v_signature
       where store_id=v_store_id;
    else
      update public.store_product_sync_state
         set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
               'upcoming_prefetch_completed_at',v_now,
               'upcoming_prefetch_valid_from',p_valid_from,
               'upcoming_prefetch_valid_to',p_valid_to,
               'upcoming_prefetch_import_id',v_import_id,
               'upcoming_prefetch_count',v_count,
               'upcoming_prefetch_request_id',p_request_id
             ),
             updated_at=v_now
       where store_id=v_store_id;
    end if;

    update public.leaflet_sources
       set last_checked_at=v_now,
           last_success_at=v_now,
           last_error=null,
           last_strategy_used=case when v_is_current then 'verified_official_pdf_text_partial' else 'verified_official_pdf_text_upcoming' end,
           last_strategy_success_at=v_now
     where id=v_source_id;

    return jsonb_build_object(
      'ok',true,
      'no_changes',true,
      'upcoming',not v_is_current,
      'import_id',v_import_id,
      'parsed',v_count,
      'published',v_count,
      'expired',0,
      'valid_from',p_valid_from,
      'valid_to',p_valid_to,
      'partial_coverage',true,
      'signature',v_signature,
      'full_payload_sha256',v_payload_hash
    );
  end if;

  v_result := private.publish_lidl_verified_markdown_full(
    p_markdown,p_valid_from,p_valid_to,p_request_id,p_pdf_url
  );

  v_import_id := nullif(v_result->>'import_id','')::uuid;
  if v_import_id is not null then
    update public.leaflet_imports
       set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'full_payload_hash_version','lidl-verified-full-payload-v1',
             'full_payload_sha256',v_payload_hash,
             'upcoming_prefetch',not v_is_current
           ),
           updated_at=clock_timestamp()
     where id=v_import_id;
  end if;

  return coalesce(v_result,'{}'::jsonb)||jsonb_build_object(
    'no_changes',false,
    'upcoming',not v_is_current,
    'signature',v_signature,
    'full_payload_sha256',v_payload_hash
  );
end;
$function$;

create or replace function private.publish_lidl_verified_markdown_full(p_markdown text, p_valid_from date, p_valid_to date, p_request_id bigint default null::bigint, p_pdf_url text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
set statement_timeout to '180s'
as $function$
declare
  v_store_id uuid;v_source_id uuid;v_import_id uuid;v_existing_import uuid;v_row record;v_product_id uuid;v_offer_id uuid;v_offer_ids uuid[]:=array[]::uuid[];
  v_count integer;v_published integer:=0;v_expired integer:=0;v_signature text;v_today date:=(now() at time zone 'Europe/Prague')::date;v_is_current boolean;v_now timestamptz:=now();
begin
  if p_pdf_url is null or p_pdf_url not ilike 'https://assets.leaflets.schwarz/%Akcni-letak-OD-%' then raise exception 'Lidl: neočekávaný zdrojový dokument.'; end if;
  if p_valid_from is null or p_valid_to is null or p_valid_from>p_valid_to or p_valid_to<v_today or p_valid_from>v_today+4 then
    raise exception 'Lidl dokument není v bezpečném aktuálním/future horizontu: % až %.',p_valid_from,p_valid_to;
  end if;
  v_is_current:=p_valid_from<=v_today and p_valid_to>=v_today;
  select id into v_store_id from public.stores where slug='lidl';
  select id into v_source_id from public.leaflet_sources where store_id=v_store_id and is_active=true order by last_success_at desc nulls last,created_at limit 1;
  if v_store_id is null or v_source_id is null then raise exception 'Lidl obchod nebo zdroj nebyl nalezen.'; end if;
  select count(*),md5(string_agg(external_key||'|'||price::text,E'\n' order by external_key)) into v_count,v_signature from public.parse_lidl_verified_markdown(p_markdown,p_valid_from,p_valid_to);
  if v_count<8 then raise exception 'Lidl bezpečný parser našel jen % produktů.',v_count; end if;
  if v_count>150 then raise exception 'Lidl bezpečný parser našel podezřele mnoho produktů: %.',v_count; end if;

  select id into v_existing_import from public.leaflet_imports where source_hash='lidl-verified-pdf-text-v1:'||v_signature limit 1;
  if v_existing_import is null then
    insert into public.leaflet_imports(source_id,store_id,source_document_url,source_hash,status,product_count,confidence,coverage_scope,detected_valid_from,detected_valid_to,started_at,metadata)
    values(v_source_id,v_store_id,p_pdf_url,'lidl-verified-pdf-text-v1:'||v_signature,'processing',0,0.99,'national',p_valid_from,p_valid_to,v_now,
      jsonb_build_object('adapter','lidl-verified-pdf-text-v1','source_signature',v_signature,'automatic',true,'request_id',p_request_id,'partial_coverage',true,'upcoming_prefetch',not v_is_current)) returning id into v_import_id;
  else
    v_import_id:=v_existing_import;delete from public.leaflet_import_items where import_id=v_import_id;
    update public.leaflet_imports set status='processing',error_message=null,started_at=v_now,finished_at=null,updated_at=v_now where id=v_import_id;
  end if;

  for v_row in select * from public.parse_lidl_verified_markdown(p_markdown,p_valid_from,p_valid_to)
  loop
    v_product_id:=null;
    select pa.product_id into v_product_id from public.product_aliases pa join public.products p on p.id=pa.product_id where pa.normalized_alias=v_row.normalized_title and (pa.source_store_id=v_store_id or pa.source_store_id is null)
      order by p.is_active desc,case when pa.source_store_id=v_store_id then 0 else 1 end,pa.confidence desc,p.is_verified desc,p.created_at limit 1;
    if v_product_id is null then select p.id into v_product_id from public.products p where coalesce(p.normalized_name,public.normalize_product_name(p.name))=v_row.normalized_title and coalesce(p.quantity_text,'')=coalesce(v_row.quantity_text,'') order by p.is_active desc,p.is_verified desc,p.created_at limit 1; end if;
    if v_product_id is null then
      begin insert into public.products(name,normalized_name,quantity_text,is_active,is_verified,metadata) values(v_row.title,v_row.normalized_title,v_row.quantity_text,true,true,jsonb_build_object('created_from_lidl_verified_pdf',true,'source_confidence',0.99)) returning id into v_product_id;
      exception when unique_violation then select p.id into v_product_id from public.products p where coalesce(p.normalized_name,public.normalize_product_name(p.name))=v_row.normalized_title order by p.is_active desc,p.is_verified desc,p.created_at limit 1; end;
    else update public.products set is_active=true,is_verified=true,quantity_text=coalesce(nullif(quantity_text,''),v_row.quantity_text),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('verified_by_lidl_pdf',true,'source_confidence',0.99),updated_at=v_now where id=v_product_id; end if;
    if v_product_id is null then raise exception 'Lidl produkt % se nepodařilo uložit.',v_row.title; end if;
    begin insert into public.product_aliases(product_id,alias,normalized_alias,quantity_text,source_store_id,confidence) values(v_product_id,v_row.title,v_row.normalized_title,v_row.quantity_text,v_store_id,0.99); exception when unique_violation then null; end;

    select id into v_offer_id from public.offers where store_id=v_store_id and external_id='lidlpdf:'||v_row.external_key and valid_from=p_valid_from and valid_to=p_valid_to limit 1;
    if v_offer_id is null then
      insert into public.offers(product_id,store_id,external_id,title,normalized_title,source_url,price,unit_price,unit_price_unit,valid_from,valid_to,status,is_verified,confidence_score,coverage_scope,metadata,published_at)
      values(v_product_id,v_store_id,'lidlpdf:'||v_row.external_key,v_row.title,v_row.normalized_title,p_pdf_url,v_row.price,v_row.unit_price,
        case when v_row.quantity_text ilike '% ml' or v_row.quantity_text ilike '% l' then 'l' else 'kg' end,p_valid_from,p_valid_to,'published',true,0.99,'national',
        v_row.metadata||jsonb_build_object('import_id',v_import_id,'source_signature',v_signature,'imported_at',v_now,'upcoming_prefetch',not v_is_current),v_now) returning id into v_offer_id;
    else
      update public.offers set product_id=v_product_id,title=v_row.title,normalized_title=v_row.normalized_title,source_url=p_pdf_url,price=v_row.price,old_price=null,unit_price=v_row.unit_price,
        unit_price_unit=case when v_row.quantity_text ilike '% ml' or v_row.quantity_text ilike '% l' then 'l' else 'kg' end,status='published',is_verified=true,confidence_score=0.99,coverage_scope='national',region_code=null,city_name=null,store_location_name=null,
        metadata=v_row.metadata||jsonb_build_object('import_id',v_import_id,'source_signature',v_signature,'imported_at',v_now,'upcoming_prefetch',not v_is_current),published_at=v_now,updated_at=v_now where id=v_offer_id;
    end if;
    v_offer_ids:=array_append(v_offer_ids,v_offer_id);v_published:=v_published+1;
    insert into public.leaflet_import_items(import_id,product_id,title,quantity_text,price,confidence,status,raw_data) values(v_import_id,v_product_id,v_row.title,v_row.quantity_text,v_row.price,0.99,'published',v_row.metadata||jsonb_build_object('offer_id',v_offer_id,'upcoming_prefetch',not v_is_current));
  end loop;

  with expired as (
    update public.offers
       set status='expired',updated_at=v_now
     where store_id=v_store_id
       and status='published'
       and valid_from=p_valid_from
       and valid_to=p_valid_to
       and (coalesce(confidence_score,0)<0.8 or external_id like 'lidlpdf:%')
       and not(id=any(v_offer_ids))
     returning id
  ) select count(*) into v_expired from expired;

  update public.leaflet_imports set status='published',product_count=v_published,confidence=0.99,detected_valid_from=p_valid_from,detected_valid_to=p_valid_to,error_message=null,finished_at=v_now,
    metadata=jsonb_build_object('adapter','lidl-verified-pdf-text-v1','source_signature',v_signature,'automatic',true,'request_id',p_request_id,'published_products',v_published,'partial_coverage',true,'upcoming_prefetch',not v_is_current),updated_at=v_now where id=v_import_id;
  update public.leaflet_imports set status='ignored',updated_at=v_now where store_id=v_store_id and id<>v_import_id and status='published' and coalesce(confidence,0)<0.8;

  if v_is_current then
    insert into public.store_product_sync_state(store_id,last_run_at,last_success_at,last_source_signature,last_offer_count,last_error,metadata,updated_at,last_valid_from,last_valid_to,is_running,run_started_at,parser_version,source_type,expected_offer_count,coverage_scope,source_category,last_http_status,last_html_length,last_parser_error,last_product_candidates,last_published_count,last_import_id,adapter_name,adapter_version,source_fingerprint,health_reason,health_status,product_set_hash)
    values(v_store_id,v_now,v_now,v_signature,v_published,null,jsonb_build_object('request_id',p_request_id,'partial_coverage',true),v_now,p_valid_from,p_valid_to,false,null,'lidl-verified-pdf-text-v1','official-pdf-text',v_count,'national','current-offers',200,length(p_markdown),null,v_count,v_published,v_import_id,'lidl-pdf-text','lidl-verified-pdf-text-v1',v_signature,
      format('Publikováno %s matematicky ověřených Lidl cen; nejednoznačné/Lidl Plus/dlouhodobé bloky vynechány.',v_published),'degraded',v_signature)
    on conflict(store_id) do update set last_run_at=v_now,last_success_at=v_now,last_source_signature=v_signature,last_offer_count=v_published,last_error=null,metadata=jsonb_build_object('request_id',p_request_id,'partial_coverage',true),updated_at=v_now,
      last_valid_from=p_valid_from,last_valid_to=p_valid_to,is_running=false,run_started_at=null,parser_version='lidl-verified-pdf-text-v1',source_type='official-pdf-text',expected_offer_count=v_count,coverage_scope='national',source_category='current-offers',last_http_status=200,last_html_length=length(p_markdown),last_parser_error=null,last_product_candidates=v_count,last_published_count=v_published,last_import_id=v_import_id,
      adapter_name='lidl-pdf-text',adapter_version='lidl-verified-pdf-text-v1',source_fingerprint=v_signature,health_reason=format('Publikováno %s matematicky ověřených Lidl cen; nejednoznačné/Lidl Plus/dlouhodobé bloky vynechány.',v_published),health_status='degraded',product_set_hash=v_signature;
  else
    update public.store_product_sync_state
       set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'upcoming_prefetch_completed_at',v_now,
             'upcoming_prefetch_valid_from',p_valid_from,
             'upcoming_prefetch_valid_to',p_valid_to,
             'upcoming_prefetch_import_id',v_import_id,
             'upcoming_prefetch_count',v_published,
             'upcoming_prefetch_request_id',p_request_id
           ),
           updated_at=v_now
     where store_id=v_store_id;
  end if;

  update public.leaflet_sources set last_checked_at=v_now,last_success_at=v_now,last_error=null,last_strategy_used=case when v_is_current then 'verified_official_pdf_text_partial' else 'verified_official_pdf_text_upcoming' end,last_strategy_success_at=v_now where id=v_source_id;
  return jsonb_build_object('ok',true,'import_id',v_import_id,'parsed',v_count,'published',v_published,'expired',v_expired,'valid_from',p_valid_from,'valid_to',p_valid_to,'partial_coverage',true,'upcoming',not v_is_current);
end;
$function$;
-- PENNY may switch its official structured HTML to tomorrow's campaign before midnight.
-- Accept only current/tomorrow campaigns and preserve the still-valid current campaign.

create or replace function public.publish_penny_structured_html(p_html text, p_request_id bigint default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
set statement_timeout to '180s'
as $function$
declare
  v_store_id uuid;
  v_source_id uuid;
  v_import_id uuid;
  v_existing_import uuid;
  v_row record;
  v_product_id uuid;
  v_offer_id uuid;
  v_offer_ids uuid[]:=array[]::uuid[];
  v_count integer;
  v_published integer:=0;
  v_expired integer:=0;
  v_signature text;
  v_from date;
  v_to date;
  v_today date:=(now() at time zone 'Europe/Prague')::date;
  v_now timestamptz:=now();
begin
  select id into v_store_id from public.stores where slug='penny';
  if v_store_id is null then raise exception 'PENNY obchod nebyl nalezen.'; end if;
  select id into v_source_id from public.leaflet_sources
    where store_id=v_store_id and is_active=true
    order by last_success_at desc nulls last,created_at
    limit 1;
  if v_source_id is null then raise exception 'PENNY nemá aktivní zdroj.'; end if;

  select count(*),min(valid_from),max(valid_to),
         md5(string_agg(external_id||'|'||price::text||'|'||coalesce(old_price::text,'')||'|'||coalesce(loyalty_price::text,'')||'|'||valid_from::text||'|'||valid_to::text,E'\n' order by external_id))
    into v_count,v_from,v_to,v_signature
  from public.parse_penny_structured_html(p_html);

  if v_count<20 then raise exception 'PENNY strukturovaný parser našel jen % produktů; stará data zůstávají zachována.',v_count; end if;
  if v_count>250 then raise exception 'PENNY strukturovaný parser našel podezřele mnoho produktů: %.',v_count; end if;
  if v_from is null or v_to is null or v_from>v_to then
    raise exception 'PENNY HTML neobsahuje bezpečnou platnost: % až %.',v_from,v_to;
  end if;
  if v_to<v_today or v_from>v_today+1 then
    raise exception 'PENNY HTML není aktuální ani zítřejší: platnost % až %, dnes %.',v_from,v_to,v_today;
  end if;

  select id into v_existing_import from public.leaflet_imports
    where source_hash='penny-structured-html-v1:'||v_signature
    limit 1;
  if v_existing_import is null then
    insert into public.leaflet_imports(
      source_id,store_id,source_document_url,source_hash,status,product_count,confidence,
      coverage_scope,detected_valid_from,detected_valid_to,started_at,metadata
    ) values(
      v_source_id,v_store_id,'https://www.penny.cz/akcni-polozky','penny-structured-html-v1:'||v_signature,
      'processing',0,0.99,'national',v_from,v_to,v_now,
      jsonb_build_object('adapter','penny-structured-html-v1','source_signature',v_signature,'automatic',true,'request_id',p_request_id)
    ) returning id into v_import_id;
  else
    v_import_id:=v_existing_import;
    delete from public.leaflet_import_items where import_id=v_import_id;
    update public.leaflet_imports
      set status='processing',error_message=null,started_at=v_now,finished_at=null,updated_at=v_now
      where id=v_import_id;
  end if;

  for v_row in select * from public.parse_penny_structured_html(p_html)
  loop
    v_product_id:=null;

    select p.id into v_product_id
    from public.products p
    where p.metadata->>'penny_product_slug'=v_row.external_id
    order by p.is_active desc,p.is_verified desc,p.created_at
    limit 1;

    if v_product_id is null then
      select pa.product_id into v_product_id
      from public.product_aliases pa
      join public.products p on p.id=pa.product_id
      where pa.normalized_alias=v_row.normalized_title
        and (pa.source_store_id=v_store_id or pa.source_store_id is null)
      order by p.is_active desc,case when pa.source_store_id=v_store_id then 0 else 1 end,pa.confidence desc,p.is_verified desc,p.created_at
      limit 1;
    end if;

    if v_product_id is null then
      select p.id into v_product_id
      from public.products p
      where coalesce(p.normalized_name,public.normalize_product_name(p.name))=v_row.normalized_title
        and coalesce(p.quantity_text,'')=coalesce(v_row.quantity_text,'')
      order by p.is_active desc,p.is_verified desc,p.created_at
      limit 1;
    end if;

    if v_product_id is null then
      begin
        insert into public.products(name,normalized_name,quantity_text,is_active,is_verified,metadata)
        values(
          v_row.title,v_row.normalized_title,v_row.quantity_text,true,true,
          jsonb_build_object('created_from_penny_structured_html',true,'penny_product_slug',v_row.external_id,'source_confidence',0.99)
        ) returning id into v_product_id;
      exception when unique_violation then
        select p.id into v_product_id
        from public.products p
        where coalesce(p.normalized_name,public.normalize_product_name(p.name))=v_row.normalized_title
        order by p.is_active desc,p.is_verified desc,p.created_at
        limit 1;
      end;
    else
      update public.products
      set is_active=true,is_verified=true,
          quantity_text=coalesce(nullif(quantity_text,''),v_row.quantity_text),
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
            'created_from_penny_structured_html',true,
            'penny_product_slug',v_row.external_id,
            'source_confidence',0.99
          ),
          updated_at=v_now
      where id=v_product_id;
    end if;

    if v_product_id is null then raise exception 'PENNY produkt % se nepodařilo uložit.',v_row.title; end if;

    begin
      insert into public.product_aliases(product_id,alias,normalized_alias,quantity_text,source_store_id,confidence)
      values(v_product_id,v_row.title,v_row.normalized_title,v_row.quantity_text,v_store_id,0.99);
    exception when unique_violation then null;
    end;

    v_offer_id:=null;
    select o.id into v_offer_id
    from public.offers o
    where o.store_id=v_store_id
      and o.external_id='penny-web:'||v_row.external_id
      and o.valid_from=v_row.valid_from
      and o.valid_to=v_row.valid_to
    limit 1;

    if v_offer_id is null then
      insert into public.offers(
        product_id,store_id,external_id,title,normalized_title,source_url,
        price,old_price,valid_from,valid_to,status,is_verified,confidence_score,
        coverage_scope,metadata,published_at
      ) values(
        v_product_id,v_store_id,'penny-web:'||v_row.external_id,v_row.title,v_row.normalized_title,
        'https://www.penny.cz/products/'||v_row.external_id,
        v_row.price,v_row.old_price,v_row.valid_from,v_row.valid_to,'published',true,0.99,
        'national',v_row.metadata||jsonb_build_object('import_id',v_import_id,'source_signature',v_signature,'imported_at',v_now),v_now
      ) returning id into v_offer_id;
    else
      update public.offers
      set product_id=v_product_id,title=v_row.title,normalized_title=v_row.normalized_title,
          source_url='https://www.penny.cz/products/'||v_row.external_id,
          price=v_row.price,old_price=v_row.old_price,status='published',is_verified=true,
          confidence_score=0.99,coverage_scope='national',region_code=null,city_name=null,store_location_name=null,
          metadata=v_row.metadata||jsonb_build_object('import_id',v_import_id,'source_signature',v_signature,'imported_at',v_now),
          published_at=v_now,updated_at=v_now
      where id=v_offer_id;
    end if;

    v_offer_ids:=array_append(v_offer_ids,v_offer_id);
    v_published:=v_published+1;

    insert into public.leaflet_import_items(
      import_id,product_id,title,quantity_text,price,old_price,confidence,status,raw_data
    ) values(
      v_import_id,v_product_id,v_row.title,v_row.quantity_text,v_row.price,v_row.old_price,0.99,'published',
      v_row.metadata||jsonb_build_object('offer_id',v_offer_id,'external_id','penny-web:'||v_row.external_id)
    );
  end loop;

  if v_published<20 then raise exception 'PENNY publikace skončila jen s % produkty.',v_published; end if;

  -- Replace only offers from the same/overlapping campaign window. A tomorrow prefetch
  -- must never expire a campaign that is still valid today and ends before v_from.
  with expired as (
    update public.offers
    set status='expired',updated_at=v_now
    where store_id=v_store_id
      and status='published'
      and metadata->>'adapter'='penny-structured-html-v1'
      and valid_from<=v_to
      and valid_to>=v_from
      and not(id=any(v_offer_ids))
    returning id
  ) select count(*) into v_expired from expired;

  update public.leaflet_imports
  set status='published',product_count=v_published,confidence=0.99,
      detected_valid_from=v_from,detected_valid_to=v_to,error_message=null,finished_at=v_now,
      metadata=jsonb_build_object(
        'adapter','penny-structured-html-v1','source_signature',v_signature,'automatic',true,
        'request_id',p_request_id,'published_products',v_published,'price_policy','public_price_uses_non_member_price',
        'prefetched_next_day',v_from>v_today
      ),updated_at=v_now
  where id=v_import_id;

  -- Keep a non-overlapping current campaign published while tomorrow is prefetched.
  update public.leaflet_imports
  set status='ignored',updated_at=v_now
  where store_id=v_store_id
    and id<>v_import_id
    and status='published'
    and coalesce(metadata->>'adapter','')='penny-structured-html-v1'
    and coalesce(detected_valid_from,'-infinity'::date)<=v_to
    and coalesce(detected_valid_to,'infinity'::date)>=v_from;

  insert into public.store_product_sync_state(
    store_id,last_run_at,last_success_at,last_source_signature,last_offer_count,last_error,metadata,updated_at,
    last_valid_from,last_valid_to,is_running,run_started_at,parser_version,source_type,expected_offer_count,
    coverage_scope,source_category,last_http_status,last_html_length,last_parser_error,last_product_candidates,
    last_published_count,last_import_id,adapter_name,adapter_version,source_fingerprint,health_reason,health_status,product_set_hash
  ) values(
    v_store_id,v_now,v_now,v_signature,v_published,null,jsonb_build_object('request_id',p_request_id,'prefetched_next_day',v_from>v_today),v_now,
    v_from,v_to,false,null,'penny-structured-html-v1','official-html-products',v_count,
    'national','current-offers',200,length(p_html),null,v_count,v_published,v_import_id,
    'penny-structured-html','penny-structured-html-v1',v_signature,
    format('Automaticky publikováno %s přesných PENNY produktů z oficiálních HTML karet%s.',v_published,case when v_from>v_today then ' pro zítřek' else '' end),'ok',v_signature
  ) on conflict(store_id) do update set
    last_run_at=excluded.last_run_at,last_success_at=excluded.last_success_at,last_source_signature=excluded.last_source_signature,
    last_offer_count=excluded.last_offer_count,last_error=null,metadata=excluded.metadata,updated_at=v_now,
    last_valid_from=excluded.last_valid_from,last_valid_to=excluded.last_valid_to,is_running=false,run_started_at=null,
    parser_version=excluded.parser_version,source_type=excluded.source_type,expected_offer_count=excluded.expected_offer_count,
    coverage_scope=excluded.coverage_scope,source_category=excluded.source_category,last_http_status=200,last_html_length=length(p_html),
    last_parser_error=null,last_product_candidates=v_count,last_published_count=v_published,last_import_id=v_import_id,
    adapter_name=excluded.adapter_name,adapter_version=excluded.adapter_version,source_fingerprint=v_signature,
    health_reason=excluded.health_reason,health_status='ok',product_set_hash=v_signature;

  update public.leaflet_sources
  set last_checked_at=v_now,last_success_at=v_now,last_error=null,
      last_strategy_used='official_html_product_cards',last_strategy_success_at=v_now
  where id=v_source_id;

  return jsonb_build_object(
    'ok',true,'import_id',v_import_id,'parsed',v_count,'published',v_published,'expired',v_expired,
    'valid_from',v_from,'valid_to',v_to,'prefetched_next_day',v_from>v_today,'signature',v_signature
  );
end;
$function$;

revoke all on function public.publish_penny_structured_html(text,bigint) from public, anon, authenticated;
grant execute on function public.publish_penny_structured_html(text,bigint) to service_role;

-- FLOP TOP: derive only unconditional weekly prices from the official current PDF.
-- PDF text is converted to markdown through r.jina.ai, then every accepted price is
-- mathematically verified against the printed unit price. Conditional/member/special
-- date sections are intentionally excluded.

create or replace function public.parse_flop_top_verified_markdown(p_markdown text)
returns table(
  external_key text,
  title text,
  normalized_title text,
  quantity_text text,
  price numeric,
  unit_price numeric,
  valid_from date,
  valid_to date,
  metadata jsonb
)
language sql
stable
set search_path to 'public','pg_temp'
as $function$
with validity as (
  select
    to_date(m[1]||'.'||m[2]||'.'||m[5],'DD.MM.YYYY') as valid_from,
    to_date(m[3]||'.'||m[4]||'.'||m[5],'DD.MM.YYYY') as valid_to
  from regexp_match(
    coalesce(p_markdown,''),
    'Platnost:\s*([0-9]{1,2})\.\s*([0-9]{1,2})\.\s*[–-]\s*([0-9]{1,2})\.\s*([0-9]{1,2})\.\s*(20[0-9]{2})',
    'i'
  ) m
), raw0 as (
  select substring(p_markdown from nullif(position('LAHŮDKY' in p_markdown),0)) as rest
), raw as (
  select case
    when position('NABÍDKA PLATÍ OD' in rest)>0 then substring(rest from 1 for position('NABÍDKA PLATÍ OD' in rest)-1)
    else rest end as text
  from raw0
), paras as (
  select ord,
    trim(regexp_replace(regexp_replace(p,'(?m)^\s*(?:#{1,3}|>)[ ]*','','g'),'\s+',' ','g')) as txt
  from raw
  cross join lateral regexp_split_to_table(coalesce(text,''),E'\n\s*\n') with ordinality x(p,ord)
), prices as (
  select ord,txt,
    case
      when txt~'^\d{1,3}\s+\d{2}(\s|$)' then substring(txt from '^(\d{1,3})')::numeric + substring(txt from '^\d{1,3}\s+(\d{2})')::numeric/100
      when txt~'^\d{3,5}(\s|$)' then substring(txt from '^(\d{3,5})')::numeric/100
    end as price
  from paras
  where txt~'^(\d{1,3}\s+\d{2}|\d{3,5})(\s|$)'
), linked as (
  select pr.ord as price_ord,pr.price,q.txt as qty_text,t.txt as raw_title
  from prices pr
  cross join lateral (
    select q.* from paras q
    where q.ord<pr.ord and q.ord>=pr.ord-3
      and q.txt~*'[0-9]+([,.][0-9]+)?\s*(g|kg|ml|l)(\s|\||$)'
      and q.txt~*'1\s*(kg|l)\s*=\s*(od\s*)?[0-9]+[,.][0-9]+'
      and q.txt!~*'s klubem|bez klubu|při koupi|při nákupu|aktivujte|cena od'
      and q.txt!~'[0-9]+\s*[–-]\s*[0-9]+'
      and q.txt!~*'[×x]|/PP|PP\s*[0-9]'
    order by q.ord desc limit 1
  ) q
  cross join lateral (
    select t.* from paras t
    where t.ord<q.ord and t.ord>=q.ord-2
      and length(t.txt) between 3 and 110
      and t.txt!~*'SUPER CENA|TOP CENA|CENA OD|Z PULTU|ČERSTVÉ|NÁLEPK|AKTIVUJTE|KUPON|BODY NAVÍC|vybrané druhy|^\d|Kč|PŘI KOUPI|S KLUBEM|BEZ KLUBU'
    order by t.ord desc limit 1
  ) t
  where pr.price between 2 and 3000
    and not exists(
      select 1 from paras x
      where x.ord between q.ord and pr.ord
        and x.txt~*'S KLUBEM|BEZ KLUBU|PŘI KOUPI|POUZE|AKTIVUJTE|KUPON'
    )
), normalized as (
  select *,
    trim(regexp_replace(regexp_replace(raw_title,'^-\s*[0-9]{1,2}\s*%\s*','','i'),'^V NABÍDCE MÁME TAKÉ\s+','','i')) as clean_title,
    regexp_match(qty_text,'([0-9]+(?:[,.][0-9]+)?)\s*(g|kg|ml|l)(?:\s|\||$)') as qm,
    regexp_match(qty_text,'1\s*(kg|l)\s*=\s*(?:od\s*)?([0-9]+[,.][0-9]+)') as um
  from linked
), checked as (
  select n.*,
    replace(qm[1],',','.')::numeric as qty_number,
    lower(qm[2]) as qty_unit,
    lower(um[1]) as unit_price_unit,
    replace(um[2],',','.')::numeric as printed_unit_price,
    case lower(qm[2])
      when 'g' then price/(replace(qm[1],',','.')::numeric/1000)
      when 'kg' then price/replace(qm[1],',','.')::numeric
      when 'ml' then price/(replace(qm[1],',','.')::numeric/1000)
      when 'l' then price/replace(qm[1],',','.')::numeric
    end as expected_unit_price
  from normalized n
  where qm is not null and um is not null
    and length(clean_title)>=3
    and clean_title!~*'^/?KS$|^[^[:alpha:]Á-ž]+$|^(CENA|AKCE|NOVINKA|SUPER CENA|TOP CENA)$'
), valid as (
  select c.*,v.valid_from,v.valid_to,
    trim(to_char(qty_number,'FM999999990D999999'))||' '||qty_unit as simple_quantity
  from checked c cross join validity v
  where ((qty_unit in('g','kg') and unit_price_unit='kg') or(qty_unit in('ml','l') and unit_price_unit='l'))
    and abs(expected_unit_price-printed_unit_price)<=greatest(1.0,printed_unit_price*0.02)
    and clean_title!~*'^[-–+%/ ]*$'
    and v.valid_from is not null and v.valid_to is not null and v.valid_from<=v.valid_to
), ranked as (
  select *,row_number() over(
    partition by public.normalize_product_name(clean_title),simple_quantity
    order by price,price_ord
  ) rn
  from valid
)
select
  md5(public.normalize_product_name(clean_title)||'|'||simple_quantity),
  clean_title,
  public.normalize_product_name(clean_title),
  simple_quantity,
  price,
  printed_unit_price,
  valid_from,
  valid_to,
  jsonb_build_object(
    'adapter','flop-top-jina-pdf-v1',
    'format','FLOP TOP',
    'source_confidence',0.99,
    'verification','printed_unit_price_math',
    'printed_unit_price',printed_unit_price,
    'coverage_note','unconditional weekly offers; cover-day, loyalty, multibuy and short-period specials excluded'
  )
from ranked where rn=1;
$function$;

revoke all on function public.parse_flop_top_verified_markdown(text) from public,anon,authenticated;
grant execute on function public.parse_flop_top_verified_markdown(text) to service_role;

create or replace function public.publish_flop_top_verified_markdown(p_markdown text,p_request_id bigint default null,p_pdf_url text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
set statement_timeout to '180s'
as $function$
declare
  v_store_id uuid;v_source_id uuid;v_import_id uuid;v_existing_import uuid;v_row record;v_product_id uuid;v_offer_id uuid;
  v_offer_ids uuid[]:=array[]::uuid[];v_count integer;v_published integer:=0;v_expired integer:=0;v_signature text;v_from date;v_to date;
  v_today date:=(now() at time zone 'Europe/Prague')::date;v_now timestamptz:=now();v_source_pdf text;
begin
  select id into v_store_id from public.stores where slug='flop';
  if v_store_id is null then raise exception 'FLOP obchod nebyl nalezen.'; end if;
  select id into v_source_id from public.leaflet_sources where store_id=v_store_id and is_active=true order by last_success_at desc nulls last,created_at limit 1;
  if v_source_id is null then raise exception 'FLOP nemá aktivní zdroj.'; end if;

  v_source_pdf:=coalesce(nullif(p_pdf_url,''),substring(p_markdown from 'URL Source:\s*(https?://[^\s]+)'));
  if v_source_pdf is null or v_source_pdf not like '%/32\_%' escape '\' or v_source_pdf ilike '%Flop_A_%' then
    raise exception 'FLOP TOP: neočekávaný zdrojový PDF dokument: %',coalesce(v_source_pdf,'NULL');
  end if;

  select count(*),min(valid_from),max(valid_to),md5(string_agg(external_key||'|'||price::text||'|'||valid_from::text||'|'||valid_to::text,E'\n' order by external_key))
  into v_count,v_from,v_to,v_signature from public.parse_flop_top_verified_markdown(p_markdown);
  if v_count<50 then raise exception 'FLOP TOP ověřený parser našel jen % produktů.',v_count; end if;
  if v_count>250 then raise exception 'FLOP TOP ověřený parser našel podezřele mnoho produktů: %.',v_count; end if;
  if not(v_from<=v_today and v_to>=v_today) then raise exception 'FLOP TOP text není aktuální: % až %, dnes %.',v_from,v_to,v_today; end if;

  select id into v_existing_import from public.leaflet_imports where source_hash='flop-top-jina-pdf-v1:'||v_signature limit 1;
  if v_existing_import is null then
    insert into public.leaflet_imports(source_id,store_id,source_document_url,source_hash,status,product_count,confidence,coverage_scope,store_location_name,detected_valid_from,detected_valid_to,started_at,metadata)
    values(v_source_id,v_store_id,v_source_pdf,'flop-top-jina-pdf-v1:'||v_signature,'processing',0,0.99,'store','FLOP TOP',v_from,v_to,v_now,
      jsonb_build_object('adapter','flop-top-jina-pdf-v1','source_signature',v_signature,'automatic',true,'request_id',p_request_id,'format','FLOP TOP','partial_coverage',true))
    returning id into v_import_id;
  else
    v_import_id:=v_existing_import;
    delete from public.leaflet_import_items where import_id=v_import_id;
    update public.leaflet_imports set status='processing',error_message=null,started_at=v_now,finished_at=null,updated_at=v_now where id=v_import_id;
  end if;

  for v_row in select * from public.parse_flop_top_verified_markdown(p_markdown)
  loop
    v_product_id:=null;
    select pa.product_id into v_product_id from public.product_aliases pa join public.products p on p.id=pa.product_id
      where pa.normalized_alias=v_row.normalized_title and (pa.source_store_id=v_store_id or pa.source_store_id is null)
      order by p.is_active desc,case when pa.source_store_id=v_store_id then 0 else 1 end,pa.confidence desc,p.is_verified desc,p.created_at limit 1;
    if v_product_id is null then
      select p.id into v_product_id from public.products p
      where coalesce(p.normalized_name,public.normalize_product_name(p.name))=v_row.normalized_title and coalesce(p.quantity_text,'')=coalesce(v_row.quantity_text,'')
      order by p.is_active desc,p.is_verified desc,p.created_at limit 1;
    end if;
    if v_product_id is null then
      begin
        insert into public.products(name,normalized_name,quantity_text,is_active,is_verified,metadata)
        values(v_row.title,v_row.normalized_title,v_row.quantity_text,true,true,jsonb_build_object('created_from_flop_top_verified_pdf',true,'source_confidence',0.99))
        returning id into v_product_id;
      exception when unique_violation then
        select p.id into v_product_id from public.products p where coalesce(p.normalized_name,public.normalize_product_name(p.name))=v_row.normalized_title order by p.is_active desc,p.is_verified desc,p.created_at limit 1;
      end;
    else
      update public.products set is_active=true,is_verified=true,quantity_text=coalesce(nullif(quantity_text,''),v_row.quantity_text),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('verified_by_flop_top_pdf',true,'source_confidence',0.99),updated_at=v_now where id=v_product_id;
    end if;
    if v_product_id is null then raise exception 'FLOP TOP produkt % se nepodařilo uložit.',v_row.title; end if;
    begin
      insert into public.product_aliases(product_id,alias,normalized_alias,quantity_text,source_store_id,confidence)
      values(v_product_id,v_row.title,v_row.normalized_title,v_row.quantity_text,v_store_id,0.99);
    exception when unique_violation then null; end;

    select id into v_offer_id from public.offers where store_id=v_store_id and external_id='floptop:'||v_row.external_key and valid_from=v_row.valid_from and valid_to=v_row.valid_to limit 1;
    if v_offer_id is null then
      insert into public.offers(product_id,store_id,external_id,title,normalized_title,source_url,price,old_price,unit_price,unit_price_unit,valid_from,valid_to,status,is_verified,confidence_score,coverage_scope,store_location_name,metadata,published_at)
      values(v_product_id,v_store_id,'floptop:'||v_row.external_key,v_row.title,v_row.normalized_title,v_source_pdf,v_row.price,null,v_row.unit_price,
        case when v_row.quantity_text ilike '% ml' or v_row.quantity_text ilike '% l' then 'l' else 'kg' end,
        v_row.valid_from,v_row.valid_to,'published',true,0.99,'store','FLOP TOP',v_row.metadata||jsonb_build_object('import_id',v_import_id,'source_signature',v_signature,'imported_at',v_now),v_now)
      returning id into v_offer_id;
    else
      update public.offers set product_id=v_product_id,title=v_row.title,normalized_title=v_row.normalized_title,source_url=v_source_pdf,price=v_row.price,old_price=null,
        unit_price=v_row.unit_price,unit_price_unit=case when v_row.quantity_text ilike '% ml' or v_row.quantity_text ilike '% l' then 'l' else 'kg' end,
        status='published',is_verified=true,confidence_score=0.99,coverage_scope='store',store_location_name='FLOP TOP',region_code=null,city_name=null,
        metadata=v_row.metadata||jsonb_build_object('import_id',v_import_id,'source_signature',v_signature,'imported_at',v_now),published_at=v_now,updated_at=v_now where id=v_offer_id;
    end if;
    v_offer_ids:=array_append(v_offer_ids,v_offer_id);v_published:=v_published+1;
    insert into public.leaflet_import_items(import_id,product_id,title,quantity_text,price,old_price,confidence,status,raw_data)
    values(v_import_id,v_product_id,v_row.title,v_row.quantity_text,v_row.price,null,0.99,'published',v_row.metadata||jsonb_build_object('offer_id',v_offer_id,'external_id','floptop:'||v_row.external_key));
  end loop;

  if v_published<50 then raise exception 'FLOP TOP publikace skončila jen s % produkty.',v_published; end if;
  with expired as (
    update public.offers set status='expired',updated_at=v_now
    where store_id=v_store_id and status='published'
      and (coalesce(store_location_name,'')='FLOP TOP' or confidence_score<0.8)
      and not(id=any(v_offer_ids)) returning id
  ) select count(*) into v_expired from expired;

  update public.leaflet_imports set status='published',product_count=v_published,confidence=0.99,coverage_scope='store',store_location_name='FLOP TOP',detected_valid_from=v_from,detected_valid_to=v_to,
    error_message=null,finished_at=v_now,metadata=jsonb_build_object('adapter','flop-top-jina-pdf-v1','source_signature',v_signature,'automatic',true,'request_id',p_request_id,'format','FLOP TOP','published_products',v_published,'partial_coverage',true),updated_at=v_now where id=v_import_id;
  update public.leaflet_imports set status='ignored',updated_at=v_now where store_id=v_store_id and id<>v_import_id and status='published' and coalesce(confidence,0)<0.8;

  insert into public.store_product_sync_state(store_id,last_run_at,last_success_at,last_source_signature,last_offer_count,last_error,metadata,updated_at,last_valid_from,last_valid_to,is_running,run_started_at,parser_version,source_type,expected_offer_count,coverage_scope,source_category,last_http_status,last_html_length,last_parser_error,last_product_candidates,last_published_count,last_import_id,adapter_name,adapter_version,source_fingerprint,health_reason,health_status,product_set_hash)
  values(v_store_id,v_now,v_now,v_signature,v_published,null,jsonb_build_object('request_id',p_request_id,'partial_coverage',true,'unparsed_format','FLOP'),v_now,v_from,v_to,false,null,
    'flop-top-jina-pdf-v1','official-pdf-text',v_count,'store','current-offers',200,length(p_markdown),null,v_count,v_published,v_import_id,'flop-top-pdf-text','flop-top-jina-pdf-v1',v_signature,
    format('Publikováno %s ověřených FLOP TOP cen; běžný FLOP leták zůstává document-only.',v_published),'degraded',v_signature)
  on conflict(store_id) do update set last_run_at=v_now,last_success_at=v_now,last_source_signature=v_signature,last_offer_count=v_published,last_error=null,
    metadata=jsonb_build_object('request_id',p_request_id,'partial_coverage',true,'unparsed_format','FLOP'),updated_at=v_now,last_valid_from=v_from,last_valid_to=v_to,is_running=false,run_started_at=null,
    parser_version='flop-top-jina-pdf-v1',source_type='official-pdf-text',expected_offer_count=v_count,coverage_scope='store',source_category='current-offers',last_http_status=200,last_html_length=length(p_markdown),
    last_parser_error=null,last_product_candidates=v_count,last_published_count=v_published,last_import_id=v_import_id,adapter_name='flop-top-pdf-text',adapter_version='flop-top-jina-pdf-v1',source_fingerprint=v_signature,
    health_reason=format('Publikováno %s ověřených FLOP TOP cen; běžný FLOP leták zůstává document-only.',v_published),health_status='degraded',product_set_hash=v_signature;

  update public.leaflet_sources set last_checked_at=v_now,last_success_at=v_now,last_error=null,last_strategy_used='verified_official_pdf_text_partial',last_strategy_success_at=v_now where id=v_source_id;
  return jsonb_build_object('ok',true,'import_id',v_import_id,'parsed',v_count,'published',v_published,'expired',v_expired,'valid_from',v_from,'valid_to',v_to,'format','FLOP TOP','partial_coverage',true);
end;
$function$;

revoke all on function public.publish_flop_top_verified_markdown(text,bigint,text) from public,anon,authenticated;
grant execute on function public.publish_flop_top_verified_markdown(text,bigint,text) to service_role;

create or replace function public.trigger_flop_top_verified_sync()
returns bigint
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare v_store_id uuid;v_pdf text;v_request_id bigint;v_now timestamptz:=now();v_today date:=(now() at time zone 'Europe/Prague')::date;
begin
  select id into v_store_id from public.stores where slug='flop';
  select li.source_document_url into v_pdf from public.leaflet_imports li
  where li.store_id=v_store_id and li.detected_valid_from<=v_today and li.detected_valid_to>=v_today
    and li.source_document_url~'/[0-9]+_[0-9]+_tisk_nahled_s\.pdf$' and li.source_document_url!~*'/Flop_A_'
  order by li.confidence desc nulls last,li.created_at desc limit 1;
  if v_pdf is null then raise exception 'FLOP TOP: aktuální oficiální PDF nebylo nalezeno.'; end if;
  if exists(select 1 from public.structured_retail_http_jobs where store_id=v_store_id and adapter='flop-top-jina-pdf-v1' and status='pending' and requested_at>v_now-interval '20 minutes') then return null; end if;
  v_request_id:=net.http_get(url:='https://r.jina.ai/'||v_pdf,headers:=jsonb_build_object('User-Agent','Slevao/1.0','Accept','text/plain,text/markdown'),timeout_milliseconds:=30000);
  insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata) values(v_request_id,v_store_id,'flop-top-jina-pdf-v1','pending',jsonb_build_object('pdf_url',v_pdf,'format','FLOP TOP'));
  update public.store_product_sync_state set last_run_at=v_now,is_running=true,run_started_at=v_now,updated_at=v_now where store_id=v_store_id;
  return v_request_id;
end;
$function$;
revoke all on function public.trigger_flop_top_verified_sync() from public,anon,authenticated;
grant execute on function public.trigger_flop_top_verified_sync() to service_role;

create or replace function public.reconcile_flop_top_verified_sync()
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp','net'
as $function$
declare v_job record;v_response record;v_result jsonb;v_done integer:=0;v_failed integer:=0;v_message text;v_now timestamptz:=now();
begin
  for v_job in select j.* from public.structured_retail_http_jobs j join public.stores s on s.id=j.store_id where s.slug='flop' and j.adapter='flop-top-jina-pdf-v1' and j.status='pending' order by j.requested_at limit 10
  loop
    select * into v_response from net._http_response where id=v_job.request_id;
    if not found then
      if v_job.requested_at<v_now-interval '20 minutes' then
        update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message='HTTP response timeout' where request_id=v_job.request_id;
        update public.store_product_sync_state set is_running=false,run_started_at=null,last_error='FLOP TOP text fetch timeout',last_parser_error='HTTP response timeout',health_status='error',health_reason='HTTP response timeout',updated_at=v_now where store_id=v_job.store_id;
        v_failed:=v_failed+1;
      end if;continue;
    end if;
    if coalesce(v_response.status_code,0)<>200 or v_response.timed_out or v_response.error_msg is not null or length(coalesce(v_response.content,''))<5000 then
      v_message:=format('FLOP TOP text HTTP %s / length %s: %s',coalesce(v_response.status_code,0),length(coalesce(v_response.content,'')),coalesce(v_response.error_msg,'invalid response'));
      update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message=v_message where request_id=v_job.request_id;
      update public.store_product_sync_state set is_running=false,run_started_at=null,last_error=v_message,last_parser_error=v_message,health_status='error',health_reason=v_message,last_http_status=v_response.status_code,updated_at=v_now where store_id=v_job.store_id;
      v_failed:=v_failed+1;continue;
    end if;
    begin
      v_result:=public.publish_flop_top_verified_markdown(v_response.content,v_job.request_id,v_job.metadata->>'pdf_url');
      update public.structured_retail_http_jobs set status='completed',processed_at=v_now,error_message=null,metadata=metadata||jsonb_build_object('result',v_result) where request_id=v_job.request_id;
      v_done:=v_done+1;
    exception when others then
      v_message:=sqlerrm;
      update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message=v_message where request_id=v_job.request_id;
      update public.store_product_sync_state set is_running=false,run_started_at=null,last_error=v_message,last_parser_error=v_message,health_status='error',health_reason=v_message,updated_at=v_now where store_id=v_job.store_id;
      update public.leaflet_sources set last_checked_at=v_now,last_error=v_message where store_id=v_job.store_id and is_active=true;
      v_failed:=v_failed+1;
    end;
  end loop;
  return jsonb_build_object('ok',v_failed=0,'completed',v_done,'failed',v_failed);
end;
$function$;
revoke all on function public.reconcile_flop_top_verified_sync() from public,anon,authenticated;
grant execute on function public.reconcile_flop_top_verified_sync() to service_role;

do $do$ declare v_id bigint;begin
  for v_id in select jobid from cron.job where jobname in('sync-flop-top-verified-products','reconcile-flop-top-verified-products') loop perform cron.unschedule(v_id); end loop;
end $do$;
select cron.schedule('sync-flop-top-verified-products','35 */3 * * *',$cron$select public.trigger_flop_top_verified_sync();$cron$);
select cron.schedule('reconcile-flop-top-verified-products','*/5 * * * *',$cron$select public.reconcile_flop_top_verified_sync();$cron$);

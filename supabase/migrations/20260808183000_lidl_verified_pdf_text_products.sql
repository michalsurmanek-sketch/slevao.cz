-- Lidl: publish only a conservative subset of current PDF products whose printed
-- unit price proves the product-price pairing and whose surrounding legal blocks
-- match the current leaflet validity. Lidl Plus and long-term "Ceny v klidu" are excluded.

create or replace function public.parse_lidl_verified_markdown(p_markdown text,p_valid_from date,p_valid_to date)
returns table(
  external_key text,title text,normalized_title text,quantity_text text,price numeric,unit_price numeric,
  valid_from date,valid_to date,metadata jsonb
)
language sql
stable
set search_path to 'public','pg_temp'
as $function$
with paras0 as (
  select ord,trim(p) raw0
  from regexp_split_to_table(coalesce(p_markdown,''),E'\n\s*\n') with ordinality x(p,ord)
), paras as (
  select ord,
    translate(raw0,'⁰¹²³⁴⁵⁶⁷⁸⁹','0123456789') raw,
    trim(regexp_replace(regexp_replace(translate(raw0,'⁰¹²³⁴⁵⁶⁷⁸⁹','0123456789'),'(?m)^\s*(?:#{1,4}|>)[ ]*','','g'),'\s+',' ','g')) txt
  from paras0
), price_rows as (
  select ord,txt,raw,
    case
      when raw~'^#\s*\d{1,4}\.\d{1,2}\s*$' then substring(raw from '^#\s*(\d{1,4})')::numeric+substring(raw from '^#\s*\d{1,4}\.(\d{1,2})')::numeric/100
      when raw~'^#\s*\d{1,4}\.\-\s*$' then substring(raw from '^#\s*(\d{1,4})')::numeric
    end price
  from paras where raw~'^#\s*\d{1,4}\.(\d{1,2}|\-)\s*$'
), linked as (
  select pr.ord price_ord,pr.price,q.ord qty_ord,q.txt qty_text,t.txt raw_title,
    (select p2.txt from paras p2 where p2.ord>pr.ord and p2.txt~*'Nabídka zboží platí' order by p2.ord limit 1) next_legal,
    (select p2.txt from paras p2 where p2.ord<pr.ord and p2.txt~*'Nabídka zboží platí' order by p2.ord desc limit 1) prev_legal
  from price_rows pr
  cross join lateral (
    select q.* from paras q
    where q.ord<pr.ord and q.ord>=pr.ord-5
      and q.txt~*'[0-9]+([,.][0-9]+)?\s*(g|kg|ml|l)(\s|,|$)'
      and q.txt~*'(1\s*(kg|l)|100\s*(g|ml))\s*=\s*[0-9]+[,.][0-9]+\s*Kč'
      and q.txt!~*'[×x]|\s/\s|Lidl Plus|různé velikosti'
    order by q.ord desc limit 1
  ) q
  cross join lateral (
    select t.* from paras t
    where t.ord<q.ord and t.ord>=q.ord-3
      and length(t.txt) between 3 and 100
      and t.txt!~*'Lidl Plus|^(Super cena|Ušetřete|Novinka|Cenový|trumf|různé druhy|více druhů|Max\.|cena za|REGION|Více na|Od čtvrtka|Nabídka|Aktivuj|Kompletní|Ceny v klidu|Další ceny|Další produkty)$'
      and t.txt!~*'^[-–+%0-9# ]+$|www\.|Kč'
    order by t.ord desc limit 1
  ) t
  where pr.price between 2 and 5000
    and not exists(select 1 from price_rows e where e.ord>q.ord and e.ord<pr.ord)
    and not exists(select 1 from paras x where x.ord between q.ord and pr.ord and x.txt~*'S Lidl Plus|Lidl Plus|Aktivuj kupón')
    and not exists(select 1 from paras x where x.ord between pr.ord and pr.ord+2 and x.txt~*'S Lidl Plus|Lidl Plus')
), legal_dates as (
  select l.*,
    regexp_match(next_legal,'platí od\s*([0-9]{1,2})\.\s*([0-9]{1,2})\.\s*do\s*([0-9]{1,2})\.\s*([0-9]{1,2})\.\s*(20[0-9]{2})','i') next_m,
    regexp_match(prev_legal,'platí od\s*([0-9]{1,2})\.\s*([0-9]{1,2})\.\s*do\s*([0-9]{1,2})\.\s*([0-9]{1,2})\.\s*(20[0-9]{2})','i') prev_m,
    regexp_match(qty_text,'([0-9]+(?:[,.][0-9]+)?)\s*(g|kg|ml|l)(?:\s|,|$)') qm,
    regexp_match(qty_text,'(1\s*(kg|l)|100\s*(g|ml))\s*=\s*([0-9]+[,.][0-9]+)\s*Kč','i') um
  from linked l
), parsed as (
  select *,
    case when next_m is not null then to_date(next_m[1]||'.'||next_m[2]||'.'||next_m[5],'DD.MM.YYYY') end next_from,
    case when next_m is not null then to_date(next_m[3]||'.'||next_m[4]||'.'||next_m[5],'DD.MM.YYYY') end next_to,
    case when prev_m is not null then to_date(prev_m[1]||'.'||prev_m[2]||'.'||prev_m[5],'DD.MM.YYYY') end prev_from,
    case when prev_m is not null then to_date(prev_m[3]||'.'||prev_m[4]||'.'||prev_m[5],'DD.MM.YYYY') end prev_to,
    replace(qm[1],',','.')::numeric qty_number,lower(qm[2]) qty_unit,replace(um[4],',','.')::numeric printed_unit_price,
    trim(to_char(replace(qm[1],',','.')::numeric,'FM999999990D999999'))||' '||lower(qm[2]) simple_quantity,
    trim(raw_title) clean_title
  from legal_dates where qm is not null and um is not null
), checked as (
  select *,case
    when qty_unit='g' and um[1]~*'^1\s*kg' then price/(qty_number/1000)
    when qty_unit='kg' and um[1]~*'^1\s*kg' then price/qty_number
    when qty_unit='ml' and um[1]~*'^1\s*l' then price/(qty_number/1000)
    when qty_unit='l' and um[1]~*'^1\s*l' then price/qty_number
    when qty_unit='g' and um[1]~*'^100\s*g' then price/(qty_number/100)
    when qty_unit='ml' and um[1]~*'^100\s*ml' then price/(qty_number/100)
  end expected_unit_price
  from parsed
), valid as (
  select * from checked
  where next_from=p_valid_from and next_to=p_valid_to
    and (prev_m is null or (prev_from=p_valid_from and prev_to=p_valid_to))
    and expected_unit_price is not null
    and abs(expected_unit_price-printed_unit_price)<=greatest(0.3,printed_unit_price*0.02)
    and clean_title!~*'Lidl Plus|^(na gril|chlazený|chlazená|baleno|vakuově|uzená/neuzená|různé druhy|více druhů|pečeně|Original|párky)$'
    and length(public.normalize_product_name(clean_title))>=3
), ranked as (
  select *,row_number() over(partition by public.normalize_product_name(clean_title),simple_quantity order by price,price_ord) rn
  from valid
)
select md5(public.normalize_product_name(clean_title)||'|'||simple_quantity),clean_title,public.normalize_product_name(clean_title),simple_quantity,
  price,printed_unit_price,p_valid_from,p_valid_to,
  jsonb_build_object('adapter','lidl-verified-pdf-text-v1','source_confidence',0.99,'verification','printed_unit_price_math_and_adjacent_validity','printed_unit_price',printed_unit_price,
    'coverage_note','conservative subset; Lidl Plus, long-term prices and ambiguous layouts excluded')
from ranked where rn=1;
$function$;

revoke all on function public.parse_lidl_verified_markdown(text,date,date) from public,anon,authenticated;
grant execute on function public.parse_lidl_verified_markdown(text,date,date) to service_role;

create or replace function public.publish_lidl_verified_markdown(p_markdown text,p_valid_from date,p_valid_to date,p_request_id bigint default null,p_pdf_url text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
set statement_timeout to '180s'
as $function$
declare
  v_store_id uuid;v_source_id uuid;v_import_id uuid;v_existing_import uuid;v_row record;v_product_id uuid;v_offer_id uuid;v_offer_ids uuid[]:=array[]::uuid[];
  v_count integer;v_published integer:=0;v_expired integer:=0;v_signature text;v_today date:=(now() at time zone 'Europe/Prague')::date;v_now timestamptz:=now();
begin
  if p_pdf_url is null or p_pdf_url not ilike 'https://assets.leaflets.schwarz/%Akcni-letak-OD-%' then raise exception 'Lidl: neočekávaný zdrojový dokument.'; end if;
  if not(p_valid_from<=v_today and p_valid_to>=v_today) then raise exception 'Lidl dokument není aktuální: % až %.',p_valid_from,p_valid_to; end if;
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
      jsonb_build_object('adapter','lidl-verified-pdf-text-v1','source_signature',v_signature,'automatic',true,'request_id',p_request_id,'partial_coverage',true)) returning id into v_import_id;
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
        v_row.metadata||jsonb_build_object('import_id',v_import_id,'source_signature',v_signature,'imported_at',v_now),v_now) returning id into v_offer_id;
    else
      update public.offers set product_id=v_product_id,title=v_row.title,normalized_title=v_row.normalized_title,source_url=p_pdf_url,price=v_row.price,old_price=null,unit_price=v_row.unit_price,
        unit_price_unit=case when v_row.quantity_text ilike '% ml' or v_row.quantity_text ilike '% l' then 'l' else 'kg' end,status='published',is_verified=true,confidence_score=0.99,coverage_scope='national',region_code=null,city_name=null,store_location_name=null,
        metadata=v_row.metadata||jsonb_build_object('import_id',v_import_id,'source_signature',v_signature,'imported_at',v_now),published_at=v_now,updated_at=v_now where id=v_offer_id;
    end if;
    v_offer_ids:=array_append(v_offer_ids,v_offer_id);v_published:=v_published+1;
    insert into public.leaflet_import_items(import_id,product_id,title,quantity_text,price,confidence,status,raw_data) values(v_import_id,v_product_id,v_row.title,v_row.quantity_text,v_row.price,0.99,'published',v_row.metadata||jsonb_build_object('offer_id',v_offer_id));
  end loop;

  with expired as (update public.offers set status='expired',updated_at=v_now where store_id=v_store_id and status='published' and (confidence_score<0.8 or external_id like 'lidlpdf:%') and not(id=any(v_offer_ids)) returning id) select count(*) into v_expired from expired;
  update public.leaflet_imports set status='published',product_count=v_published,confidence=0.99,detected_valid_from=p_valid_from,detected_valid_to=p_valid_to,error_message=null,finished_at=v_now,
    metadata=jsonb_build_object('adapter','lidl-verified-pdf-text-v1','source_signature',v_signature,'automatic',true,'request_id',p_request_id,'published_products',v_published,'partial_coverage',true),updated_at=v_now where id=v_import_id;
  update public.leaflet_imports set status='ignored',updated_at=v_now where store_id=v_store_id and id<>v_import_id and status='published' and coalesce(confidence,0)<0.8;

  insert into public.store_product_sync_state(store_id,last_run_at,last_success_at,last_source_signature,last_offer_count,last_error,metadata,updated_at,last_valid_from,last_valid_to,is_running,run_started_at,parser_version,source_type,expected_offer_count,coverage_scope,source_category,last_http_status,last_html_length,last_parser_error,last_product_candidates,last_published_count,last_import_id,adapter_name,adapter_version,source_fingerprint,health_reason,health_status,product_set_hash)
  values(v_store_id,v_now,v_now,v_signature,v_published,null,jsonb_build_object('request_id',p_request_id,'partial_coverage',true),v_now,p_valid_from,p_valid_to,false,null,'lidl-verified-pdf-text-v1','official-pdf-text',v_count,'national','current-offers',200,length(p_markdown),null,v_count,v_published,v_import_id,'lidl-pdf-text','lidl-verified-pdf-text-v1',v_signature,
    format('Publikováno %s matematicky ověřených Lidl cen; nejednoznačné/Lidl Plus/dlouhodobé bloky vynechány.',v_published),'degraded',v_signature)
  on conflict(store_id) do update set last_run_at=v_now,last_success_at=v_now,last_source_signature=v_signature,last_offer_count=v_published,last_error=null,metadata=jsonb_build_object('request_id',p_request_id,'partial_coverage',true),updated_at=v_now,
    last_valid_from=p_valid_from,last_valid_to=p_valid_to,is_running=false,run_started_at=null,parser_version='lidl-verified-pdf-text-v1',source_type='official-pdf-text',expected_offer_count=v_count,coverage_scope='national',source_category='current-offers',last_http_status=200,last_html_length=length(p_markdown),last_parser_error=null,last_product_candidates=v_count,last_published_count=v_published,last_import_id=v_import_id,
    adapter_name='lidl-pdf-text',adapter_version='lidl-verified-pdf-text-v1',source_fingerprint=v_signature,health_reason=format('Publikováno %s matematicky ověřených Lidl cen; nejednoznačné/Lidl Plus/dlouhodobé bloky vynechány.',v_published),health_status='degraded',product_set_hash=v_signature;
  update public.leaflet_sources set last_checked_at=v_now,last_success_at=v_now,last_error=null,last_strategy_used='verified_official_pdf_text_partial',last_strategy_success_at=v_now where id=v_source_id;
  return jsonb_build_object('ok',true,'import_id',v_import_id,'parsed',v_count,'published',v_published,'expired',v_expired,'valid_from',p_valid_from,'valid_to',p_valid_to,'partial_coverage',true);
end;
$function$;
revoke all on function public.publish_lidl_verified_markdown(text,date,date,bigint,text) from public,anon,authenticated;
grant execute on function public.publish_lidl_verified_markdown(text,date,date,bigint,text) to service_role;

create or replace function public.trigger_lidl_verified_sync()
returns bigint
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare v_store_id uuid;v_pdf text;v_from date;v_to date;v_request_id bigint;v_now timestamptz:=now();v_today date:=(now() at time zone 'Europe/Prague')::date;
begin
  select id into v_store_id from public.stores where slug='lidl';
  select li.source_document_url,li.detected_valid_from,li.detected_valid_to into v_pdf,v_from,v_to from public.leaflet_imports li
  where li.store_id=v_store_id and li.detected_valid_from<=v_today and li.detected_valid_to>=v_today and li.source_document_url ilike 'https://assets.leaflets.schwarz/%Akcni-letak-OD-%'
  order by li.created_at desc limit 1;
  if v_pdf is null then raise exception 'Lidl: aktuální hlavní PDF nebylo nalezeno.'; end if;
  if exists(select 1 from public.structured_retail_http_jobs where store_id=v_store_id and adapter='lidl-verified-pdf-text-v1' and status='pending' and requested_at>v_now-interval '20 minutes') then return null; end if;
  v_request_id:=net.http_get(url:='https://r.jina.ai/'||v_pdf,headers:=jsonb_build_object('User-Agent','Slevao/1.0','Accept','text/plain,text/markdown'),timeout_milliseconds:=30000);
  insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata) values(v_request_id,v_store_id,'lidl-verified-pdf-text-v1','pending',jsonb_build_object('pdf_url',v_pdf,'valid_from',v_from,'valid_to',v_to));
  update public.store_product_sync_state set last_run_at=v_now,is_running=true,run_started_at=v_now,updated_at=v_now where store_id=v_store_id;
  return v_request_id;
end;
$function$;
revoke all on function public.trigger_lidl_verified_sync() from public,anon,authenticated;grant execute on function public.trigger_lidl_verified_sync() to service_role;

create or replace function public.reconcile_lidl_verified_sync()
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp','net'
as $function$
declare v_job record;v_response record;v_result jsonb;v_done integer:=0;v_failed integer:=0;v_message text;v_now timestamptz:=now();
begin
  for v_job in select j.* from public.structured_retail_http_jobs j join public.stores s on s.id=j.store_id where s.slug='lidl' and j.adapter='lidl-verified-pdf-text-v1' and j.status='pending' order by j.requested_at limit 10
  loop
    select * into v_response from net._http_response where id=v_job.request_id;
    if not found then if v_job.requested_at<v_now-interval '20 minutes' then update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message='HTTP response timeout' where request_id=v_job.request_id;v_failed:=v_failed+1;end if;continue;end if;
    if coalesce(v_response.status_code,0)<>200 or v_response.timed_out or v_response.error_msg is not null or length(coalesce(v_response.content,''))<5000 then
      v_message:=format('Lidl text HTTP %s / length %s: %s',coalesce(v_response.status_code,0),length(coalesce(v_response.content,'')),coalesce(v_response.error_msg,'invalid response'));
      update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message=v_message where request_id=v_job.request_id;
      update public.store_product_sync_state set is_running=false,run_started_at=null,last_error=v_message,last_parser_error=v_message,health_status='error',health_reason=v_message,last_http_status=v_response.status_code,updated_at=v_now where store_id=v_job.store_id;v_failed:=v_failed+1;continue;
    end if;
    begin
      v_result:=public.publish_lidl_verified_markdown(v_response.content,(v_job.metadata->>'valid_from')::date,(v_job.metadata->>'valid_to')::date,v_job.request_id,v_job.metadata->>'pdf_url');
      update public.structured_retail_http_jobs set status='completed',processed_at=v_now,error_message=null,metadata=metadata||jsonb_build_object('result',v_result) where request_id=v_job.request_id;v_done:=v_done+1;
    exception when others then
      v_message:=sqlerrm;update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message=v_message where request_id=v_job.request_id;
      update public.store_product_sync_state set is_running=false,run_started_at=null,last_error=v_message,last_parser_error=v_message,health_status='error',health_reason=v_message,updated_at=v_now where store_id=v_job.store_id;
      update public.leaflet_sources set last_checked_at=v_now,last_error=v_message where store_id=v_job.store_id and is_active=true;v_failed:=v_failed+1;
    end;
  end loop;
  return jsonb_build_object('ok',v_failed=0,'completed',v_done,'failed',v_failed);
end;
$function$;
revoke all on function public.reconcile_lidl_verified_sync() from public,anon,authenticated;grant execute on function public.reconcile_lidl_verified_sync() to service_role;

do $do$ declare v_id bigint;begin for v_id in select jobid from cron.job where jobname in('sync-lidl-verified-products','reconcile-lidl-verified-products') loop perform cron.unschedule(v_id);end loop;end $do$;
select cron.schedule('sync-lidl-verified-products','20 */3 * * *',$cron$select public.trigger_lidl_verified_sync();$cron$);
select cron.schedule('reconcile-lidl-verified-products','*/5 * * * *',$cron$select public.reconcile_lidl_verified_sync();$cron$);

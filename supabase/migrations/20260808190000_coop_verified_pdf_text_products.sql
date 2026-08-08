-- COOP: publish only unambiguous prices from the official current PDF.
-- Each accepted price must be adjacent to a single package quantity and must match
-- the printed unit price mathematically. Coupon/app, PP and range/multipack rows are excluded.

create or replace function public.parse_coop_verified_markdown(p_markdown text)
returns table(
  external_key text,title text,normalized_title text,quantity_text text,price numeric,unit_price numeric,
  valid_from date,valid_to date,metadata jsonb
)
language sql
stable
set search_path to 'public','pg_temp'
as $function$
with validity as (
  select
    to_date(m[1]||'.'||m[2]||'.'||m[5],'DD.MM.YYYY') valid_from,
    to_date(m[3]||'.'||m[4]||'.'||m[5],'DD.MM.YYYY') valid_to
  from regexp_match(
    coalesce(p_markdown,''),
    'Nabídka platí[^\n]*od\s*([0-9]{1,2})\.\s*([0-9]{1,2})\.\s*do\s*([0-9]{1,2})\.\s*([0-9]{1,2})\.\s*(20[0-9]{2})',
    'i'
  ) m
), paras as (
  select ord,trim(regexp_replace(regexp_replace(p,'(?m)^\s*(?:#{1,3}|>)[ ]*','','g'),'\s+',' ','g')) txt
  from regexp_split_to_table(coalesce(p_markdown,''),E'\n\s*\n') with ordinality x(p,ord)
), qty as (
  select q.ord qty_ord,q.txt qty_text,
    regexp_match(q.txt,'([0-9]+(?:[,.][0-9]+)?)\s*(g|kg|ml|l)(?:\s|\||$)','i') qm,
    regexp_match(q.txt,'(1\s*(kg|l)|100\s*(g|ml))\s*=\s*([0-9 ]+[,.][0-9]+|[0-9 ]+,?[–-])\s*Kč','i') um
  from paras q
  where q.txt~*'[0-9]+(?:[,.][0-9]+)?\s*(g|kg|ml|l)'
    and q.txt~*'(1\s*(kg|l)|100\s*(g|ml))\s*='
    and q.txt!~*'S KUPÓNEM|BEZ KUPÓNU|PP\s|/|×|x\s*[0-9]'
), candidates as (
  select q.*,p.ord price_ord,p.txt price_text,
    case
      when p.txt~'^\d{1,4}\s*,\s*\d{2}$' then substring(p.txt from '^(\d{1,4})')::numeric+substring(p.txt from ',\s*(\d{2})$')::numeric/100
      when p.txt~'^\d{1,4}\s*,\s*[–-]$' then substring(p.txt from '^(\d{1,4})')::numeric
      when p.txt~'^\d{1,4}[.]\d{2}$' then p.txt::numeric
    end price,
    (select t.txt from paras t
      where t.ord<q.qty_ord and t.ord>=q.qty_ord-3
        and regexp_replace(t.txt,'^[0-9]{1,4}\s*,\s*(?:\d{2}|[–-])\s+','','i')=upper(regexp_replace(t.txt,'^[0-9]{1,4}\s*,\s*(?:\d{2}|[–-])\s+','','i'))
        and regexp_replace(t.txt,'^[0-9]{1,4}\s*,\s*(?:\d{2}|[–-])\s+','','i')~'[[:alpha:]Á-ž]'
        and length(t.txt) between 3 and 100
        and t.txt!~*'^(CC|CENA|NABÍDKA|S KUPÓNEM|BEZ KUPÓNU|CENA S|CENA BEZ|VYBRANÉ DRUHY|CLASSIC|100%)'
      order by t.ord desc limit 1) raw_title
  from qty q
  join paras p on p.ord=q.qty_ord+1
  where p.txt~'^\d{1,4}\s*,\s*(\d{2}|[–-])$' or p.txt~'^\d{1,4}[.]\d{2}$'
), calc as (
  select *,replace(qm[1],',','.')::numeric qty_number,lower(qm[2]) qty_unit,
    case when um[4]~'[–-]' then regexp_replace(um[4],'[^0-9]','','g')::numeric else replace(replace(um[4],' ',''),',','.')::numeric end printed_unit,
    um[1] unit_basis,
    regexp_replace(raw_title,'^[0-9]{1,4}\s*,\s*(?:\d{2}|[–-])\s+','','i') clean_base,
    substring(qty_text from '^([[:alpha:]Á-ž][[:alpha:]Á-ž ]+)\s+[0-9]') qty_prefix,
    (replace(qm[1],',','.')::numeric)::text||' '||lower(qm[2]) simple_quantity
  from candidates
  where qm is not null and um is not null and price is not null and raw_title is not null
), checked as (
  select *,case
    when qty_unit='g' and unit_basis~*'^1\s*kg' then price/(qty_number/1000)
    when qty_unit='kg' and unit_basis~*'^1\s*kg' then price/qty_number
    when qty_unit='ml' and unit_basis~*'^1\s*l' then price/(qty_number/1000)
    when qty_unit='l' and unit_basis~*'^1\s*l' then price/qty_number
    when qty_unit='g' and unit_basis~*'^100\s*g' then price/(qty_number/100)
    when qty_unit='ml' and unit_basis~*'^100\s*ml' then price/(qty_number/100)
  end expected_unit
  from calc
), valid as (
  select *,case
    when qty_prefix is not null and upper(qty_prefix)=qty_prefix and position(qty_prefix in clean_base)=0
      then clean_base||' / '||trim(qty_prefix)
    else clean_base
  end clean_title
  from checked
  where expected_unit is not null
    and abs(expected_unit-printed_unit)<=greatest(0.35,printed_unit*0.02)
), ranked as (
  select v.*,val.valid_from,val.valid_to,
    row_number() over(partition by public.normalize_product_name(clean_title),simple_quantity order by price,qty_ord) rn
  from valid v cross join validity val
  where val.valid_from is not null and val.valid_to is not null and val.valid_from<=val.valid_to
)
select
  md5(public.normalize_product_name(clean_title)||'|'||simple_quantity),
  clean_title,
  public.normalize_product_name(clean_title),
  simple_quantity,
  price,
  printed_unit,
  valid_from,
  valid_to,
  jsonb_build_object(
    'adapter','coop-verified-pdf-text-v1',
    'source_confidence',0.99,
    'verification','adjacent_single_price_and_printed_unit_price_math',
    'printed_unit_price',printed_unit,
    'selected_stores_only',true,
    'coverage_note','selected COOP stores; coupon/app, PP, ranges and ambiguous multi-column rows excluded'
  )
from ranked where rn=1;
$function$;

revoke all on function public.parse_coop_verified_markdown(text) from public,anon,authenticated;
grant execute on function public.parse_coop_verified_markdown(text) to service_role;

create or replace function public.publish_coop_verified_markdown(p_markdown text,p_request_id bigint default null,p_pdf_url text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
set statement_timeout to '180s'
as $function$
declare
  v_store_id uuid;v_source_id uuid;v_import_id uuid;v_existing_import uuid;v_row record;v_product_id uuid;v_offer_id uuid;v_offer_ids uuid[]:=array[]::uuid[];
  v_count integer;v_published integer:=0;v_expired integer:=0;v_signature text;v_from date;v_to date;v_today date:=(now() at time zone 'Europe/Prague')::date;v_now timestamptz:=now();
begin
  if p_pdf_url is null or p_pdf_url not ilike 'https://www.coopclub.cz/%' or p_pdf_url not ilike '%.pdf' then raise exception 'COOP: neočekávaný PDF zdroj.'; end if;
  select id into v_store_id from public.stores where slug='coop';
  select id into v_source_id from public.leaflet_sources where store_id=v_store_id and is_active=true order by last_success_at desc nulls last,created_at limit 1;
  if v_store_id is null or v_source_id is null then raise exception 'COOP obchod nebo zdroj nebyl nalezen.'; end if;
  select count(*),min(valid_from),max(valid_to),md5(string_agg(external_key||'|'||price::text,E'\n' order by external_key))
    into v_count,v_from,v_to,v_signature from public.parse_coop_verified_markdown(p_markdown);
  if v_count<12 then raise exception 'COOP bezpečný parser našel jen % produktů.',v_count; end if;
  if v_count>150 then raise exception 'COOP bezpečný parser našel podezřele mnoho produktů: %.',v_count; end if;
  if not(v_from<=v_today and v_to>=v_today) then raise exception 'COOP dokument není aktuální: % až %.',v_from,v_to; end if;

  select id into v_existing_import from public.leaflet_imports where source_hash='coop-verified-pdf-text-v1:'||v_signature limit 1;
  if v_existing_import is null then
    insert into public.leaflet_imports(source_id,store_id,source_document_url,source_hash,status,product_count,confidence,coverage_scope,store_location_name,detected_valid_from,detected_valid_to,started_at,metadata)
    values(v_source_id,v_store_id,p_pdf_url,'coop-verified-pdf-text-v1:'||v_signature,'processing',0,0.99,'store','Vybrané prodejny COOP',v_from,v_to,v_now,
      jsonb_build_object('adapter','coop-verified-pdf-text-v1','source_signature',v_signature,'automatic',true,'request_id',p_request_id,'partial_coverage',true,'selected_stores_only',true)) returning id into v_import_id;
  else
    v_import_id:=v_existing_import;delete from public.leaflet_import_items where import_id=v_import_id;
    update public.leaflet_imports set status='processing',error_message=null,started_at=v_now,finished_at=null,updated_at=v_now where id=v_import_id;
  end if;

  for v_row in select * from public.parse_coop_verified_markdown(p_markdown)
  loop
    v_product_id:=null;
    select pa.product_id into v_product_id from public.product_aliases pa join public.products p on p.id=pa.product_id
      where pa.normalized_alias=v_row.normalized_title and (pa.source_store_id=v_store_id or pa.source_store_id is null)
      order by p.is_active desc,case when pa.source_store_id=v_store_id then 0 else 1 end,pa.confidence desc,p.is_verified desc,p.created_at limit 1;
    if v_product_id is null then select p.id into v_product_id from public.products p where coalesce(p.normalized_name,public.normalize_product_name(p.name))=v_row.normalized_title and coalesce(p.quantity_text,'')=coalesce(v_row.quantity_text,'') order by p.is_active desc,p.is_verified desc,p.created_at limit 1; end if;
    if v_product_id is null then
      begin insert into public.products(name,normalized_name,quantity_text,is_active,is_verified,metadata) values(v_row.title,v_row.normalized_title,v_row.quantity_text,true,true,jsonb_build_object('created_from_coop_verified_pdf',true,'source_confidence',0.99)) returning id into v_product_id;
      exception when unique_violation then select p.id into v_product_id from public.products p where coalesce(p.normalized_name,public.normalize_product_name(p.name))=v_row.normalized_title order by p.is_active desc,p.is_verified desc,p.created_at limit 1; end;
    else update public.products set is_active=true,is_verified=true,quantity_text=coalesce(nullif(quantity_text,''),v_row.quantity_text),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('verified_by_coop_pdf',true,'source_confidence',0.99),updated_at=v_now where id=v_product_id; end if;
    if v_product_id is null then raise exception 'COOP produkt % se nepodařilo uložit.',v_row.title; end if;
    begin insert into public.product_aliases(product_id,alias,normalized_alias,quantity_text,source_store_id,confidence) values(v_product_id,v_row.title,v_row.normalized_title,v_row.quantity_text,v_store_id,0.99); exception when unique_violation then null; end;

    select id into v_offer_id from public.offers where store_id=v_store_id and external_id='cooppdf:'||v_row.external_key and valid_from=v_row.valid_from and valid_to=v_row.valid_to limit 1;
    if v_offer_id is null then
      insert into public.offers(product_id,store_id,external_id,title,normalized_title,source_url,price,unit_price,unit_price_unit,valid_from,valid_to,status,is_verified,confidence_score,coverage_scope,store_location_name,metadata,published_at)
      values(v_product_id,v_store_id,'cooppdf:'||v_row.external_key,v_row.title,v_row.normalized_title,p_pdf_url,v_row.price,v_row.unit_price,
        case when v_row.quantity_text ilike '% ml' or v_row.quantity_text ilike '% l' then 'l' else 'kg' end,v_row.valid_from,v_row.valid_to,'published',true,0.99,'store','Vybrané prodejny COOP',
        v_row.metadata||jsonb_build_object('import_id',v_import_id,'source_signature',v_signature,'imported_at',v_now),v_now) returning id into v_offer_id;
    else
      update public.offers set product_id=v_product_id,title=v_row.title,normalized_title=v_row.normalized_title,source_url=p_pdf_url,price=v_row.price,old_price=null,unit_price=v_row.unit_price,
        unit_price_unit=case when v_row.quantity_text ilike '% ml' or v_row.quantity_text ilike '% l' then 'l' else 'kg' end,status='published',is_verified=true,confidence_score=0.99,
        coverage_scope='store',store_location_name='Vybrané prodejny COOP',region_code=null,city_name=null,
        metadata=v_row.metadata||jsonb_build_object('import_id',v_import_id,'source_signature',v_signature,'imported_at',v_now),published_at=v_now,updated_at=v_now where id=v_offer_id;
    end if;
    v_offer_ids:=array_append(v_offer_ids,v_offer_id);v_published:=v_published+1;
    insert into public.leaflet_import_items(import_id,product_id,title,quantity_text,price,confidence,status,raw_data)
    values(v_import_id,v_product_id,v_row.title,v_row.quantity_text,v_row.price,0.99,'published',v_row.metadata||jsonb_build_object('offer_id',v_offer_id));
  end loop;

  with expired as (update public.offers set status='expired',updated_at=v_now where store_id=v_store_id and status='published' and (confidence_score<0.8 or external_id like 'cooppdf:%') and not(id=any(v_offer_ids)) returning id) select count(*) into v_expired from expired;
  update public.leaflet_imports set status='published',product_count=v_published,confidence=0.99,coverage_scope='store',store_location_name='Vybrané prodejny COOP',detected_valid_from=v_from,detected_valid_to=v_to,error_message=null,finished_at=v_now,
    metadata=jsonb_build_object('adapter','coop-verified-pdf-text-v1','source_signature',v_signature,'automatic',true,'request_id',p_request_id,'published_products',v_published,'partial_coverage',true,'selected_stores_only',true),updated_at=v_now where id=v_import_id;
  update public.leaflet_imports set status='ignored',updated_at=v_now where store_id=v_store_id and id<>v_import_id and status='published' and coalesce(confidence,0)<0.8;

  insert into public.store_product_sync_state(store_id,last_run_at,last_success_at,last_source_signature,last_offer_count,last_error,metadata,updated_at,last_valid_from,last_valid_to,is_running,run_started_at,parser_version,source_type,expected_offer_count,coverage_scope,source_category,last_http_status,last_html_length,last_parser_error,last_product_candidates,last_published_count,last_import_id,adapter_name,adapter_version,source_fingerprint,health_reason,health_status,product_set_hash)
  values(v_store_id,v_now,v_now,v_signature,v_published,null,jsonb_build_object('request_id',p_request_id,'partial_coverage',true,'selected_stores_only',true),v_now,v_from,v_to,false,null,'coop-verified-pdf-text-v1','official-pdf-text',v_count,'store','current-offers',200,length(p_markdown),null,v_count,v_published,v_import_id,'coop-pdf-text','coop-verified-pdf-text-v1',v_signature,
    format('Publikováno %s matematicky ověřených COOP cen pro vybrané prodejny; kupónové a nejednoznačné položky vynechány.',v_published),'degraded',v_signature)
  on conflict(store_id) do update set last_run_at=v_now,last_success_at=v_now,last_source_signature=v_signature,last_offer_count=v_published,last_error=null,metadata=jsonb_build_object('request_id',p_request_id,'partial_coverage',true,'selected_stores_only',true),updated_at=v_now,
    last_valid_from=v_from,last_valid_to=v_to,is_running=false,run_started_at=null,parser_version='coop-verified-pdf-text-v1',source_type='official-pdf-text',expected_offer_count=v_count,coverage_scope='store',source_category='current-offers',last_http_status=200,last_html_length=length(p_markdown),last_parser_error=null,last_product_candidates=v_count,last_published_count=v_published,last_import_id=v_import_id,
    adapter_name='coop-pdf-text',adapter_version='coop-verified-pdf-text-v1',source_fingerprint=v_signature,health_reason=format('Publikováno %s matematicky ověřených COOP cen pro vybrané prodejny; kupónové a nejednoznačné položky vynechány.',v_published),health_status='degraded',product_set_hash=v_signature;
  update public.leaflet_sources set last_checked_at=v_now,last_success_at=v_now,last_error=null,last_strategy_used='verified_official_pdf_text_partial',last_strategy_success_at=v_now where id=v_source_id;
  return jsonb_build_object('ok',true,'import_id',v_import_id,'parsed',v_count,'published',v_published,'expired',v_expired,'valid_from',v_from,'valid_to',v_to,'partial_coverage',true,'selected_stores_only',true);
end;
$function$;

revoke all on function public.publish_coop_verified_markdown(text,bigint,text) from public,anon,authenticated;
grant execute on function public.publish_coop_verified_markdown(text,bigint,text) to service_role;

create or replace function public.trigger_coop_verified_sync()
returns bigint
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare v_store_id uuid;v_pdf text;v_request_id bigint;v_now timestamptz:=now();v_today date:=(now() at time zone 'Europe/Prague')::date;
begin
  select id into v_store_id from public.stores where slug='coop';
  select li.source_document_url into v_pdf from public.leaflet_imports li
  where li.store_id=v_store_id and li.detected_valid_from<=v_today and li.detected_valid_to>=v_today and li.source_document_url ilike 'https://www.coopclub.cz/%pdf'
  order by li.created_at desc limit 1;
  if v_pdf is null then raise exception 'COOP: aktuální PDF nebylo nalezeno.'; end if;
  if exists(select 1 from public.structured_retail_http_jobs where store_id=v_store_id and adapter='coop-verified-pdf-text-v1' and status='pending' and requested_at>v_now-interval '20 minutes') then return null; end if;
  v_request_id:=net.http_get(url:='https://r.jina.ai/'||v_pdf,headers:=jsonb_build_object('User-Agent','Slevao/1.0','Accept','text/plain,text/markdown'),timeout_milliseconds:=30000);
  insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata) values(v_request_id,v_store_id,'coop-verified-pdf-text-v1','pending',jsonb_build_object('pdf_url',v_pdf));
  update public.store_product_sync_state set last_run_at=v_now,is_running=true,run_started_at=v_now,updated_at=v_now where store_id=v_store_id;
  return v_request_id;
end;
$function$;
revoke all on function public.trigger_coop_verified_sync() from public,anon,authenticated;grant execute on function public.trigger_coop_verified_sync() to service_role;

create or replace function public.reconcile_coop_verified_sync()
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp','net'
as $function$
declare v_job record;v_response record;v_result jsonb;v_done integer:=0;v_failed integer:=0;v_message text;v_now timestamptz:=now();
begin
  for v_job in select j.* from public.structured_retail_http_jobs j join public.stores s on s.id=j.store_id where s.slug='coop' and j.adapter='coop-verified-pdf-text-v1' and j.status='pending' order by j.requested_at limit 10
  loop
    select * into v_response from net._http_response where id=v_job.request_id;
    if not found then if v_job.requested_at<v_now-interval '20 minutes' then update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message='HTTP response timeout' where request_id=v_job.request_id;v_failed:=v_failed+1;end if;continue;end if;
    if coalesce(v_response.status_code,0)<>200 or v_response.timed_out or v_response.error_msg is not null or length(coalesce(v_response.content,''))<3000 then
      v_message:=format('COOP text HTTP %s / length %s: %s',coalesce(v_response.status_code,0),length(coalesce(v_response.content,'')),coalesce(v_response.error_msg,'invalid response'));
      update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message=v_message where request_id=v_job.request_id;
      update public.store_product_sync_state set is_running=false,run_started_at=null,last_error=v_message,last_parser_error=v_message,health_status='error',health_reason=v_message,last_http_status=v_response.status_code,updated_at=v_now where store_id=v_job.store_id;v_failed:=v_failed+1;continue;
    end if;
    begin
      v_result:=public.publish_coop_verified_markdown(v_response.content,v_job.request_id,v_job.metadata->>'pdf_url');
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
revoke all on function public.reconcile_coop_verified_sync() from public,anon,authenticated;grant execute on function public.reconcile_coop_verified_sync() to service_role;

do $do$ declare v_id bigint;begin for v_id in select jobid from cron.job where jobname in('sync-coop-verified-products','reconcile-coop-verified-products') loop perform cron.unschedule(v_id);end loop;end $do$;
select cron.schedule('sync-coop-verified-products','30 */3 * * *',$cron$select public.trigger_coop_verified_sync();$cron$);
select cron.schedule('reconcile-coop-verified-products','*/5 * * * *',$cron$select public.reconcile_coop_verified_sync();$cron$);

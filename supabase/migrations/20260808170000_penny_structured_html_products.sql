-- PENNY exposes current promotion cards as structured server-rendered HTML.
-- This importer intentionally avoids the low-confidence PDF/OCR product path.

create table if not exists public.structured_retail_http_jobs (
  request_id bigint primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  adapter text not null,
  status text not null default 'pending' check (status in ('pending','completed','failed')),
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.structured_retail_http_jobs enable row level security;
revoke all on public.structured_retail_http_jobs from public, anon, authenticated;
grant all on public.structured_retail_http_jobs to service_role;
create index if not exists idx_structured_retail_http_jobs_pending
  on public.structured_retail_http_jobs(status, requested_at)
  where status='pending';

create or replace function public.parse_penny_structured_html(p_html text)
returns table (
  external_id text,
  title text,
  normalized_title text,
  quantity_text text,
  price numeric,
  old_price numeric,
  loyalty_price numeric,
  valid_from date,
  valid_to date,
  metadata jsonb
)
language sql
stable
set search_path to 'public','pg_temp'
as $function$
with blocks as (
  select ord, block
  from regexp_split_to_table(coalesce(p_html,''), 'data-test="product-tile"') with ordinality x(block,ord)
  where ord>1
), extracted as (
  select
    ord,
    block,
    substring(block from 'data-product-slug="([^"]+)"') as slug,
    replace(replace(substring(block from 'data-teaser-name="([^"]+)"'),'&amp;','&'),'&quot;','"') as product_title,
    replace(replace(substring(block from '<li>([^<]+)</li>'),'&nbsp;',' '),chr(160),' ') as qty,
    substring(block from 'od&nbsp;[[:alpha:]]+&nbsp;([0-9]{2}\.[0-9]{2}\.[0-9]{4})') as from_text,
    substring(block from 'do&nbsp;[[:alpha:]]+&nbsp;([0-9]{2}\.[0-9]{2}\.[0-9]{4})') as to_text,
    block ilike '%s PENNY kartou%' as has_loyalty_price,
    (
      select array_agg(
        replace(regexp_replace(m[1],'[^0-9,]','','g'),',','.')::numeric
        order by n
      )
      from regexp_matches(block,'ws-product-price-value__main[^>]*>([^<]+)</span>','gi') with ordinality pm(m,n)
    ) as prices,
    (
      select replace(regexp_replace(m[1],'[^0-9,]','','g'),',','.')::numeric
      from regexp_matches(block,'<s[^>]*>([^<]+)</s>','gi') pm(m)
      limit 1
    ) as strike_price
  from blocks
), normalized as (
  select
    ord, slug, trim(product_title) as product_title, nullif(trim(qty),'') as qty,
    has_loyalty_price, prices, strike_price,
    case when from_text is not null then to_date(from_text,'DD.MM.YYYY') end as from_date,
    case when to_text is not null then to_date(to_text,'DD.MM.YYYY') end as to_date_value
  from extracted
  where slug is not null
    and product_title is not null
    and array_length(prices,1) between 1 and 2
), valid as (
  select
    ord,
    slug,
    product_title,
    public.normalize_product_name(product_title) as norm,
    qty,
    case when has_loyalty_price then prices[1] else prices[array_length(prices,1)] end as public_price,
    case when has_loyalty_price then prices[2] else null end as card_price,
    case when has_loyalty_price then null else strike_price end as previous_price,
    from_date,
    to_date_value,
    has_loyalty_price
  from normalized
  where from_date is not null and to_date_value is not null
), ranked as (
  select *, row_number() over (
    partition by norm,coalesce(qty,''),public_price,from_date,to_date_value
    order by ord,slug
  ) as rn
  from valid
  where length(norm)>=3
    and public_price between 2 and 10000
    and from_date<=to_date_value
)
select
  slug,
  product_title,
  norm,
  qty,
  public_price,
  case when previous_price is not null and previous_price>=public_price then previous_price else null end,
  card_price,
  from_date,
  to_date_value,
  jsonb_strip_nulls(jsonb_build_object(
    'adapter','penny-structured-html-v1',
    'penny_product_slug',slug,
    'product_url','https://www.penny.cz/products/'||slug,
    'requires_loyalty_card_for_lower_price',has_loyalty_price,
    'loyalty_price',card_price,
    'price_without_loyalty_card',public_price,
    'price_policy','public_price_uses_non_member_price'
  ))
from ranked
where rn=1;
$function$;

revoke all on function public.parse_penny_structured_html(text) from public, anon, authenticated;
grant execute on function public.parse_penny_structured_html(text) to service_role;

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
         md5(string_agg(external_id||'|'||price::text||'|'||coalesce(old_price::text,'')||'|'||coalesce(loyalty_price::text,'')||'|'||valid_from::text||'|'||valid_to::text,'\n' order by external_id))
    into v_count,v_from,v_to,v_signature
  from public.parse_penny_structured_html(p_html);

  if v_count<20 then raise exception 'PENNY strukturovaný parser našel jen % produktů; stará data zůstávají zachována.',v_count; end if;
  if v_count>250 then raise exception 'PENNY strukturovaný parser našel podezřele mnoho produktů: %.',v_count; end if;
  if not (v_from<=v_today and v_to>=v_today) then
    raise exception 'PENNY HTML není aktuální: platnost % až %, dnes %.',v_from,v_to,v_today;
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

  with expired as (
    update public.offers
    set status='expired',updated_at=v_now
    where store_id=v_store_id and status='published' and not(id=any(v_offer_ids))
    returning id
  ) select count(*) into v_expired from expired;

  update public.leaflet_imports
  set status='published',product_count=v_published,confidence=0.99,
      detected_valid_from=v_from,detected_valid_to=v_to,error_message=null,finished_at=v_now,
      metadata=jsonb_build_object(
        'adapter','penny-structured-html-v1','source_signature',v_signature,'automatic',true,
        'request_id',p_request_id,'published_products',v_published,'price_policy','public_price_uses_non_member_price'
      ),updated_at=v_now
  where id=v_import_id;

  update public.leaflet_imports
  set status='ignored',updated_at=v_now
  where store_id=v_store_id and id<>v_import_id and status='published'
    and coalesce(metadata->>'adapter','') in ('store:penny-flippingbook','generic');

  insert into public.store_product_sync_state(
    store_id,last_run_at,last_success_at,last_source_signature,last_offer_count,last_error,metadata,updated_at,
    last_valid_from,last_valid_to,is_running,run_started_at,parser_version,source_type,expected_offer_count,
    coverage_scope,source_category,last_http_status,last_html_length,last_parser_error,last_product_candidates,
    last_published_count,last_import_id,adapter_name,adapter_version,source_fingerprint,health_reason,health_status,product_set_hash
  ) values(
    v_store_id,v_now,v_now,v_signature,v_published,null,jsonb_build_object('request_id',p_request_id),v_now,
    v_from,v_to,false,null,'penny-structured-html-v1','official-html-products',v_count,
    'national','current-offers',200,length(p_html),null,v_count,v_published,v_import_id,
    'penny-structured-html','penny-structured-html-v1',v_signature,
    format('Automaticky publikováno %s přesných PENNY produktů z oficiálních HTML karet.',v_published),'ok',v_signature
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
    'valid_from',v_from,'valid_to',v_to,'signature',v_signature
  );
end;
$function$;

revoke all on function public.publish_penny_structured_html(text,bigint) from public, anon, authenticated;
grant execute on function public.publish_penny_structured_html(text,bigint) to service_role;

create or replace function public.trigger_penny_structured_sync()
returns bigint
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_store_id uuid;
  v_request_id bigint;
  v_now timestamptz:=now();
begin
  select id into v_store_id from public.stores where slug='penny';
  if v_store_id is null then raise exception 'PENNY obchod nebyl nalezen.'; end if;

  if exists(
    select 1 from public.structured_retail_http_jobs
    where store_id=v_store_id and adapter='penny-structured-html-v1' and status='pending' and requested_at>v_now-interval '15 minutes'
  ) then return null; end if;

  v_request_id:=net.http_get(
    url:='https://www.penny.cz/akcni-polozky',
    headers:=jsonb_build_object('User-Agent','Mozilla/5.0 (compatible; Slevao/1.0)','Accept-Language','cs-CZ,cs;q=0.9','Accept','text/html,application/xhtml+xml'),
    timeout_milliseconds:=20000
  );

  insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
  values(v_request_id,v_store_id,'penny-structured-html-v1','pending',jsonb_build_object('url','https://www.penny.cz/akcni-polozky'));

  insert into public.store_product_sync_state(store_id,last_run_at,is_running,run_started_at,parser_version,adapter_name,adapter_version,source_type,updated_at)
  values(v_store_id,v_now,true,v_now,'penny-structured-html-v1','penny-structured-html','penny-structured-html-v1','official-html-products',v_now)
  on conflict(store_id) do update set last_run_at=v_now,is_running=true,run_started_at=v_now,parser_version='penny-structured-html-v1',adapter_name='penny-structured-html',adapter_version='penny-structured-html-v1',source_type='official-html-products',updated_at=v_now;

  return v_request_id;
end;
$function$;

revoke all on function public.trigger_penny_structured_sync() from public, anon, authenticated;
grant execute on function public.trigger_penny_structured_sync() to service_role;

create or replace function public.reconcile_penny_structured_sync()
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp','net'
as $function$
declare
  v_job record;
  v_response record;
  v_result jsonb;
  v_done integer:=0;
  v_failed integer:=0;
  v_message text;
  v_now timestamptz:=now();
begin
  for v_job in
    select j.* from public.structured_retail_http_jobs j
    join public.stores s on s.id=j.store_id
    where s.slug='penny' and j.adapter='penny-structured-html-v1' and j.status='pending'
    order by j.requested_at
    limit 10
  loop
    select * into v_response from net._http_response where id=v_job.request_id;
    if not found then
      if v_job.requested_at<v_now-interval '15 minutes' then
        update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message='HTTP response timeout' where request_id=v_job.request_id;
        update public.store_product_sync_state set is_running=false,run_started_at=null,last_error='PENNY structured HTML: HTTP response timeout',last_parser_error='HTTP response timeout',health_status='error',health_reason='HTTP response timeout',updated_at=v_now where store_id=v_job.store_id;
        v_failed:=v_failed+1;
      end if;
      continue;
    end if;

    if coalesce(v_response.status_code,0)<>200 or v_response.timed_out or v_response.error_msg is not null then
      v_message:=format('PENNY HTTP %s: %s',coalesce(v_response.status_code,0),coalesce(v_response.error_msg,'request failed'));
      update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message=v_message where request_id=v_job.request_id;
      update public.store_product_sync_state set is_running=false,run_started_at=null,last_error=v_message,last_parser_error=v_message,health_status='error',health_reason=v_message,last_http_status=v_response.status_code,updated_at=v_now where store_id=v_job.store_id;
      v_failed:=v_failed+1;
      continue;
    end if;

    begin
      v_result:=public.publish_penny_structured_html(v_response.content,v_job.request_id);
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

revoke all on function public.reconcile_penny_structured_sync() from public, anon, authenticated;
grant execute on function public.reconcile_penny_structured_sync() to service_role;

-- Remove older copies of these jobs if the migration is re-run.
do $do$
declare v_id bigint;
begin
  for v_id in select jobid from cron.job where jobname in ('sync-penny-structured-products','reconcile-penny-structured-products')
  loop perform cron.unschedule(v_id); end loop;
end
$do$;

select cron.schedule(
  'sync-penny-structured-products',
  '15 * * * *',
  $cron$select public.trigger_penny_structured_sync();$cron$
);
select cron.schedule(
  'reconcile-penny-structured-products',
  '*/5 * * * *',
  $cron$select public.reconcile_penny_structured_sync();$cron$
);

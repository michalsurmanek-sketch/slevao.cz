create or replace function public.parse_sportisimo_sale_markdown(p_markdown text)
returns table(
  external_id text,
  title text,
  normalized_title text,
  subtitle text,
  price numeric,
  old_price numeric,
  discount_percent integer,
  valid_from date,
  valid_to date,
  source_url text,
  sportisimo_product_id text
)
language sql
stable
set search_path = public, pg_temp
as $function$
with src as (
  select replace(coalesce(p_markdown,''), chr(160), ' ') as c
), bounds as (
  select c,
         position('Řadit dle:' in c) as product_start,
         position('Dalších 48 produktů' in c) as product_end,
         case when position('Řadit dle:' in c)>1 then left(c,position('Řadit dle:' in c)-1) else c end as promo_header
  from src
), dates as (
  select c,product_start,product_end,
         regexp_match(promo_header,'od[[:space:]]+([0-9]{1,2})[.][[:space:]]*([0-9]{1,2})[.][[:space:]]*([0-9]{4})') as m_from,
         regexp_match(promo_header,'do[[:space:]]+([0-9]{1,2})[.][[:space:]]*([0-9]{1,2})[.][[:space:]]*([0-9]{4})') as m_to
  from bounds
), prepared as (
  select c,
         case when product_start>0 and product_end>product_start then substring(c from product_start for product_end-product_start) else '' end as product_text,
         case when m_from is not null then make_date((m_from)[3]::int,(m_from)[2]::int,(m_from)[1]::int) end as vf,
         case when m_to is not null then make_date((m_to)[3]::int,(m_to)[2]::int,(m_to)[1]::int) end as vt
  from dates
), cards0 as (
  select ord,
         (x)[1] as title,
         (x)[2] as subtitle,
         replace((x)[3],' ','')::numeric as price,
         (x)[4]::int as discount_percent,
         replace((x)[5],' ','')::numeric as old_price,
         vf,vt,c
  from prepared,
       lateral regexp_matches(
         product_text,
         E'(?:^|\\n)(?:[0-9]+\\n)?([^\\n]{3,120})\\n([^\\n]{2,120})\\n([0-9][0-9 ]*) Kč \\(-([0-9]+) %\\)\\n(?:DMOC: )?([0-9][0-9 ]*) Kč\\nSkladem',
         'g'
       ) with ordinality as z(x,ord)
), cards as (
  select *,
         regexp_replace(public.normalize_product_name(title),'[^a-z0-9]+','','g') as match_key,
         row_number() over(
           partition by regexp_replace(public.normalize_product_name(title),'[^a-z0-9]+','','g')
           order by ord
         ) as key_rn
  from cards0
  where price>0 and old_price>price and discount_percent between 5 and 90
), lines as (
  select ord,line
  from prepared,
       lateral regexp_split_to_table(c,E'\\n') with ordinality as t(line,ord)
), urls0 as (
  select ord,
         substring(line from 'https://www[.]sportisimo[.]cz/([^/ )]+)/[^/ )]+/[0-9]+/') as brand_slug,
         substring(line from 'https://www[.]sportisimo[.]cz/[^/ )]+/([^/ )]+)/[0-9]+/') as model_slug,
         substring(line from 'https://www[.]sportisimo[.]cz/[^/ )]+/[^/ )]+/([0-9]+)/') as product_id,
         substring(line from '(https://www[.]sportisimo[.]cz/[^ )]+/[0-9]+/)') as url
  from lines
  where substring(line from 'https://www[.]sportisimo[.]cz/[^/ )]+/[^/ )]+/([0-9]+)/') is not null
), urls as (
  select *,
         regexp_replace(
           public.normalize_product_name(replace(brand_slug,'-',' ')||' '||replace(model_slug,'-',' ')),
           '[^a-z0-9]+','','g'
         ) as match_key,
         row_number() over(
           partition by regexp_replace(
             public.normalize_product_name(replace(brand_slug,'-',' ')||' '||replace(model_slug,'-',' ')),
             '[^a-z0-9]+','','g'
           )
           order by ord
         ) as key_rn
  from urls0
)
select 'sportisimo:'||u.product_id,
       c.title,
       public.normalize_product_name(c.title),
       c.subtitle,
       c.price,
       c.old_price,
       c.discount_percent,
       c.vf,
       c.vt,
       u.url,
       u.product_id
from cards c
join urls u using(match_key,key_rn)
where c.vf is not null
  and c.vt is not null
  and c.vf<=c.vt
  and u.url like 'https://www.sportisimo.cz/%';
$function$;

create or replace function public.trigger_sportisimo_verified_sync()
returns bigint
language plpgsql
security definer
set search_path = public, net, pg_temp
as $function$
declare
  v_store uuid;
  v_req bigint;
  v_run uuid := gen_random_uuid();
  v_now timestamptz := now();
begin
  select id into v_store from public.stores where slug='sportisimo';
  if v_store is null then return null; end if;

  if exists(
    select 1 from public.structured_retail_http_jobs
    where store_id=v_store
      and adapter='sportisimo-sale-frontpage-v1'
      and status='pending'
      and requested_at>v_now-interval '20 minutes'
  ) then
    return null;
  end if;

  v_req := net.http_get(
    url := 'https://r.jina.ai/https://www.sportisimo.cz/vyprodej/',
    headers := jsonb_build_object(
      'User-Agent','Slevao/1.0',
      'Accept','text/plain,text/markdown',
      'X-With-Links-Summary','true'
    ),
    timeout_milliseconds := 30000
  );

  insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
  values(
    v_req,v_store,'sportisimo-sale-frontpage-v1','pending',
    jsonb_build_object(
      'run_id',v_run,
      'source_url','https://www.sportisimo.cz/vyprodej/',
      'coverage_scope','sale_frontpage_strict_identity'
    )
  );

  update public.store_product_sync_state
  set last_run_at=v_now,
      is_running=true,
      run_started_at=v_now,
      health_status='running',
      health_reason='Sportisimo: načítám oficiální výprodej se stabilní produktovou identitou.',
      last_error=null,
      last_parser_error=null,
      adapter_name='sportisimo-jina-sale-frontpage-v1',
      adapter_version='sportisimo-jina-sale-frontpage-v1',
      source_type='official-structured',
      source_category='clearance',
      coverage_scope='sale_frontpage_strict_identity',
      minimum_offer_count=30,
      expected_offer_count=48,
      count_tolerance_percent=40,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'mode','dedicated_official_sale_frontpage',
        'source_url','https://www.sportisimo.cz/vyprodej/',
        'fetch_via','jina_reader_links_summary'
      ),
      updated_at=v_now
  where store_id=v_store;

  return v_req;
end;
$function$;

create or replace function public.reconcile_sportisimo_verified_sync()
returns jsonb
language plpgsql
security definer
set search_path = public, net, pg_temp
as $function$
declare
  j record;
  r record;
  v_now timestamptz := now();
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_rows jsonb;
  v_count int;
  v_distinct int;
  v_from date;
  v_to date;
  v_signature text;
  v_result jsonb;
  v_done int := 0;
  v_failed int := 0;
  v_msg text;
begin
  for j in
    select * from public.structured_retail_http_jobs
    where adapter='sportisimo-sale-frontpage-v1' and status='pending'
    order by requested_at
    limit 5
  loop
    select * into r from net._http_response where id=j.request_id;

    if not found then
      if j.requested_at<v_now-interval '20 minutes' then
        v_msg := 'Sportisimo výprodej: timeout zdroje.';
        update public.structured_retail_http_jobs
          set status='failed',processed_at=v_now,error_message=v_msg
          where request_id=j.request_id;
        update public.store_product_sync_state
          set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,
              health_status='error',health_reason=v_msg,updated_at=v_now
          where store_id=j.store_id;
        v_failed:=v_failed+1;
      end if;
      continue;
    end if;

    if coalesce(r.status_code,0)<>200
       or r.timed_out
       or r.error_msg is not null
       or length(coalesce(r.content,''))<25000
       or lower(coalesce(r.content,'')) like '%performing security verification%'
       or lower(coalesce(r.content,'')) like '%just a moment%' then
      v_msg := format(
        'Sportisimo výprodej: neplatná odpověď HTTP %s / length %s.',
        coalesce(r.status_code,0),length(coalesce(r.content,''))
      );
      update public.structured_retail_http_jobs
        set status='failed',processed_at=v_now,error_message=v_msg
        where request_id=j.request_id;
      update public.store_product_sync_state
        set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,
            health_status='error',health_reason=v_msg,last_http_status=coalesce(r.status_code,0),
            last_html_length=length(coalesce(r.content,'')),updated_at=v_now
        where store_id=j.store_id;
      v_failed:=v_failed+1;
      continue;
    end if;

    select jsonb_agg(
             jsonb_build_object(
               'external_id',p.external_id,
               'title',p.title,
               'normalized_title',p.normalized_title,
               'quantity_text',null,
               'price',p.price,
               'old_price',p.old_price,
               'valid_from',p.valid_from,
               'valid_to',p.valid_to,
               'source_url',p.source_url,
               'source_page',1,
               'product_id',null,
               'image_url',null,
               'confidence',0.99,
               'metadata',jsonb_build_object(
                 'adapter','sportisimo-jina-sale-frontpage-v1',
                 'parser_version','sportisimo-jina-sale-frontpage-v1',
                 'sportisimo_product_id',p.sportisimo_product_id,
                 'discount_percent',p.discount_percent,
                 'subtitle',p.subtitle,
                 'coverage_scope','sale_frontpage_strict_identity',
                 'price_policy','consumer_price_including_vat'
               )
             ) order by p.external_id
           ),
           count(*),count(distinct p.external_id),min(p.valid_from),max(p.valid_to),
           md5(string_agg(p.external_id||'|'||p.price::text||'|'||p.old_price::text||'|'||p.valid_from::text||'|'||p.valid_to::text,E'\n' order by p.external_id))
    into v_rows,v_count,v_distinct,v_from,v_to,v_signature
    from public.parse_sportisimo_sale_markdown(r.content) p;

    if v_from is null or v_to is null then
      v_msg := 'Sportisimo výprodej: nepodařilo se bezpečně určit platnost kampaně.';
      update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message=v_msg where request_id=j.request_id;
      update public.store_product_sync_state
        set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,health_status='error',health_reason=v_msg,
            last_product_candidates=coalesce(v_count,0),updated_at=v_now
        where store_id=j.store_id;
      v_failed:=v_failed+1;
      continue;
    end if;

    if v_today<v_from then
      v_msg := format('Sportisimo: další výprodejová kampaň začíná %s.',v_from);
      update public.structured_retail_http_jobs set status='completed',processed_at=v_now,error_message=null,metadata=metadata||jsonb_build_object('result','waiting_future_campaign') where request_id=j.request_id;
      update public.store_product_sync_state
        set is_running=false,run_started_at=null,last_error=null,last_parser_error=null,health_status='waiting_source',health_reason=v_msg,
            last_valid_from=v_from,last_valid_to=v_to,last_product_candidates=coalesce(v_count,0),updated_at=v_now
        where store_id=j.store_id;
      v_done:=v_done+1;
      continue;
    end if;

    if v_today>v_to then
      v_msg := format('Sportisimo: poslední výprodejová kampaň skončila %s; čekám na novou.',v_to);
      update public.structured_retail_http_jobs set status='completed',processed_at=v_now,error_message=null,metadata=metadata||jsonb_build_object('result','waiting_new_campaign') where request_id=j.request_id;
      update public.store_product_sync_state
        set is_running=false,run_started_at=null,last_error=null,last_parser_error=null,health_status='waiting_source',health_reason=v_msg,
            last_valid_from=v_from,last_valid_to=v_to,last_product_candidates=coalesce(v_count,0),updated_at=v_now
        where store_id=j.store_id;
      v_done:=v_done+1;
      continue;
    end if;

    if coalesce(v_count,0)<30 or coalesce(v_count,0)>60 or v_distinct<>v_count then
      v_msg := format('Sportisimo parser vytvořil %s nabídek (%s unikátních); bezpečný rozsah je 30–60.',coalesce(v_count,0),coalesce(v_distinct,0));
      update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message=v_msg where request_id=j.request_id;
      update public.store_product_sync_state
        set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,health_status='error',health_reason=v_msg,
            last_product_candidates=coalesce(v_count,0),updated_at=v_now
        where store_id=j.store_id;
      v_failed:=v_failed+1;
      continue;
    end if;

    begin
      v_result := public.publish_structured_store_offers(
        'sportisimo',
        'sportisimo-jina-sale-frontpage-v1',
        v_signature,
        v_rows,
        30,
        60,
        'https://www.sportisimo.cz/vyprodej/',
        'sportisimo-jina-sale-frontpage-v1'
      );

      update public.structured_retail_http_jobs
        set status='completed',processed_at=v_now,error_message=null,
            metadata=metadata||jsonb_build_object('result',v_result,'published',true,'offer_count',v_count)
        where request_id=j.request_id;
      update public.store_product_sync_state
        set is_running=false,run_started_at=null,last_error=null,last_parser_error=null,
            health_status='ok',health_reason=format('Automaticky publikováno %s ověřených výprodejových nabídek Sportisimo z první stránky.',v_count),
            last_http_status=coalesce(r.status_code,200),last_html_length=length(coalesce(r.content,'')),
            last_product_candidates=v_count,coverage_scope='sale_frontpage_strict_identity',updated_at=v_now
        where store_id=j.store_id;
      v_done:=v_done+1;
    exception when others then
      v_msg:=sqlerrm;
      update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message=v_msg where request_id=j.request_id;
      update public.store_product_sync_state
        set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,health_status='error',health_reason=v_msg,updated_at=v_now
        where store_id=j.store_id;
      v_failed:=v_failed+1;
    end;
  end loop;

  return jsonb_build_object('ok',v_failed=0,'completed',v_done,'failed',v_failed);
end;
$function$;

revoke all on function public.parse_sportisimo_sale_markdown(text) from public, anon, authenticated;
revoke all on function public.trigger_sportisimo_verified_sync() from public, anon, authenticated;
revoke all on function public.reconcile_sportisimo_verified_sync() from public, anon, authenticated;

update public.store_product_sync_state st
set adapter_name='sportisimo-jina-sale-frontpage-v1',
    adapter_version='sportisimo-jina-sale-frontpage-v1',
    source_type='official-structured',
    source_category='clearance',
    coverage_scope='sale_frontpage_strict_identity',
    minimum_offer_count=30,
    expected_offer_count=48,
    count_tolerance_percent=40,
    health_status='waiting_source',
    health_reason='Sportisimo: dedikovaná výprodejová pipeline připravena; čekám na první ověřený běh.',
    last_error=null,
    last_parser_error=null,
    is_running=false,
    run_started_at=null,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'mode','dedicated_official_sale_frontpage',
      'source_url','https://www.sportisimo.cz/vyprodej/',
      'fetch_via','jina_reader_links_summary'
    ),
    updated_at=now()
from public.stores s
where st.store_id=s.id and s.slug='sportisimo';

do $block$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='sync-sportisimo-verified-products' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule('sync-sportisimo-verified-products','17 */6 * * *','select public.trigger_sportisimo_verified_sync();');

  v_job:=null;
  select jobid into v_job from cron.job where jobname='reconcile-sportisimo-verified-products' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule('reconcile-sportisimo-verified-products','*/5 * * * *','select public.reconcile_sportisimo_verified_sync();');
end;
$block$;

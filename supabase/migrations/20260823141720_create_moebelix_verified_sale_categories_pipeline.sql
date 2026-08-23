create or replace function public.parse_moebelix_sale_category_markdown(p_markdown text)
returns table(
  external_id text,
  title text,
  normalized_title text,
  price numeric,
  old_price numeric,
  discount_percent integer,
  source_url text,
  image_url text,
  moebelix_product_id text
)
language sql
stable
set search_path = public, pg_temp
as $function$
with src as (
  select replace(coalesce(p_markdown,''), chr(160), ' ') as c
), cards0 as (
  select ord,
         (m)[1] as old_price_text,
         (m)[2] as price_text,
         trim((m)[3]) as card_text,
         (m)[4] as image_url,
         (m)[5]::int as discount_percent
  from src,
       lateral regexp_matches(
         c,
         E'~~místo[[:space:]]+([0-9][0-9 ]*),[[:space:]]*‒[[:space:]]*Kč(?:[*]{2})?~~[[:space:]]+([0-9][0-9 ]*),[[:space:]]*‒[[:space:]]*Kč[[:space:]]+vč[.] DPH(?:[[:space:]]+plus)?[[:space:]]+!\\[Image [0-9]+: ([^]\\n]+)\\]\\((https://media[.]moebelix[.]com/[^ )]+)\\)[[:space:]]+-([0-9]+)% Z REKLAMY',
         'g'
       ) with ordinality as z(m,ord)
), cards as (
  select ord,
         replace(old_price_text,' ','')::numeric as old_price,
         replace(price_text,' ','')::numeric as price,
         card_text,
         image_url,
         discount_percent,
         regexp_replace(public.normalize_product_name(card_text),'[^a-z0-9]+','','g') as card_key
  from cards0
  where replace(old_price_text,' ','')::numeric > replace(price_text,' ','')::numeric
    and discount_percent between 5 and 90
    and image_url like 'https://media.moebelix.com/%'
), links0 as (
  select ord,
         trim((m)[1]) as title,
         (m)[2] as url,
         substring((m)[2] from '-([0-9]{12})$') as product_id
  from src,
       lateral regexp_matches(
         c,
         E'- \\[([^]\\n]+)\\]\\((https://www[.]moebelix[.]cz/p/[^ )]+-[0-9]{12})\\)',
         'g'
       ) with ordinality as z(m,ord)
), links as (
  select ord,title,url,product_id,
         regexp_replace(public.normalize_product_name(title),'[^a-z0-9]+','','g') as link_key
  from links0
  where product_id is not null
), candidates as (
  select c.ord,c.old_price,c.price,c.card_text,c.image_url,c.discount_percent,
         l.title,l.url,l.product_id,
         count(*) over(partition by c.ord) as card_match_count
  from cards c
  join links l on c.card_key like l.link_key||'%'
), unique_card as (
  select * from candidates where card_match_count=1
), unique_identity as (
  select *,count(*) over(partition by product_id) as product_card_count
  from unique_card
)
select 'moebelix:'||product_id,
       title,
       public.normalize_product_name(title),
       price,
       old_price,
       discount_percent,
       url,
       image_url,
       product_id
from unique_identity
where product_card_count=1
  and url like 'https://www.moebelix.cz/p/%'
  and product_id ~ '^[0-9]{12}$';
$function$;

create or replace function public.trigger_moebelix_verified_sync()
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
  select id into v_store from public.stores where slug='moebelix';
  if v_store is null then return null; end if;

  if exists(
    select 1
    from public.structured_retail_http_jobs
    where store_id=v_store
      and adapter in ('moebelix-sale-index-v1','moebelix-sale-category-v1')
      and status='pending'
      and requested_at>v_now-interval '30 minutes'
  ) then
    return null;
  end if;

  v_req := net.http_get(
    url := 'https://r.jina.ai/https://www.moebelix.cz/c/slevy',
    headers := jsonb_build_object(
      'User-Agent','Slevao/1.0',
      'Accept','text/plain,text/markdown',
      'X-With-Links-Summary','true'
    ),
    timeout_milliseconds := 30000
  );

  insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
  values(
    v_req,v_store,'moebelix-sale-index-v1','pending',
    jsonb_build_object(
      'run_id',v_run::text,
      'source_url','https://www.moebelix.cz/c/slevy',
      'coverage_scope','all_sale_categories_strict_identity',
      'published',false
    )
  );

  insert into public.store_product_sync_state(
    store_id,last_run_at,is_running,run_started_at,health_status,health_reason,
    last_error,last_parser_error,adapter_name,adapter_version,parser_version,
    source_type,source_category,coverage_scope,minimum_offer_count,
    expected_offer_count,count_tolerance_percent,metadata,updated_at
  )
  values(
    v_store,v_now,true,v_now,'running','Möbelix: načítám oficiální SALE index a všechny výprodejové kategorie.',
    null,null,'moebelix-jina-sale-categories-v1','moebelix-jina-sale-categories-v1','moebelix-jina-sale-categories-v1',
    'official-structured','sale','all_sale_categories_strict_identity',60,
    182,50,jsonb_build_object(
      'mode','dedicated_official_sale_categories',
      'source_url','https://www.moebelix.cz/c/slevy',
      'fetch_via','jina_reader_links_summary',
      'run_id',v_run::text
    ),v_now
  )
  on conflict(store_id) do update set
    last_run_at=excluded.last_run_at,
    is_running=true,
    run_started_at=excluded.run_started_at,
    health_status='running',
    health_reason=excluded.health_reason,
    last_error=null,
    last_parser_error=null,
    adapter_name=excluded.adapter_name,
    adapter_version=excluded.adapter_version,
    parser_version=excluded.parser_version,
    source_type=excluded.source_type,
    source_category=excluded.source_category,
    coverage_scope=excluded.coverage_scope,
    minimum_offer_count=excluded.minimum_offer_count,
    expected_offer_count=excluded.expected_offer_count,
    count_tolerance_percent=excluded.count_tolerance_percent,
    metadata=coalesce(public.store_product_sync_state.metadata,'{}'::jsonb)||excluded.metadata,
    updated_at=v_now;

  return v_req;
end;
$function$;

create or replace function public.reconcile_moebelix_verified_sync()
returns jsonb
language plpgsql
security definer
set search_path = public, net, pg_temp
as $function$
declare
  j record;
  r record;
  runrec record;
  v_now timestamptz := now();
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_urls text[];
  v_url text;
  v_category_count int;
  v_req bigint;
  v_parsed int;
  v_rows jsonb;
  v_count int;
  v_conflicts int;
  v_signature text;
  v_total_html_length int;
  v_result jsonb;
  v_done int := 0;
  v_failed int := 0;
  v_msg text;
begin
  for j in
    select *
    from public.structured_retail_http_jobs
    where adapter='moebelix-sale-index-v1' and status='pending'
    order by requested_at
    limit 5
  loop
    select * into r from net._http_response where id=j.request_id;

    if not found then
      if j.requested_at<v_now-interval '20 minutes' then
        v_msg := 'Möbelix SALE index: timeout zdroje.';
        update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message=v_msg where request_id=j.request_id;
        update public.store_product_sync_state set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,health_status='error',health_reason=v_msg,updated_at=v_now where store_id=j.store_id;
        update public.leaflet_sources set last_checked_at=v_now,last_error=v_msg,updated_at=v_now where store_id=j.store_id and is_active=true;
        v_failed:=v_failed+1;
      end if;
      continue;
    end if;

    if coalesce(r.status_code,0)<>200 or r.timed_out or r.error_msg is not null or length(coalesce(r.content,''))<10000
       or lower(coalesce(r.content,'')) like '%just a moment%' or lower(coalesce(r.content,'')) like '%access denied%'
       or lower(coalesce(r.content,'')) like '%human verification%' or lower(coalesce(r.content,'')) like '%captcha%' then
      v_msg := format('Möbelix SALE index: neplatná odpověď HTTP %s / length %s.',coalesce(r.status_code,0),length(coalesce(r.content,'')));
      update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message=v_msg where request_id=j.request_id;
      update public.store_product_sync_state set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,health_status='error',health_reason=v_msg,last_http_status=coalesce(r.status_code,0),last_html_length=length(coalesce(r.content,'')),updated_at=v_now where store_id=j.store_id;
      update public.leaflet_sources set last_checked_at=v_now,last_error=v_msg,updated_at=v_now where store_id=j.store_id and is_active=true;
      v_failed:=v_failed+1;
      continue;
    end if;

    select array_agg(q.url order by q.url),count(*) into v_urls,v_category_count
    from (
      select distinct (m)[1] as url
      from regexp_matches(r.content,'(https://www[.]moebelix[.]cz/[^ )]+[?]p_eyecatcher=[^ )]+)','g') as z(m)
      where (m)[1] like 'https://www.moebelix.cz/%'
    ) q;

    if coalesce(v_category_count,0)<8 or v_category_count>15 then
      v_msg := format('Möbelix SALE index obsahuje %s kategorií; bezpečný rozsah je 8–15.',coalesce(v_category_count,0));
      update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message=v_msg where request_id=j.request_id;
      update public.store_product_sync_state set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,health_status='error',health_reason=v_msg,last_http_status=coalesce(r.status_code,200),last_html_length=length(coalesce(r.content,'')),updated_at=v_now where store_id=j.store_id;
      v_failed:=v_failed+1;
      continue;
    end if;

    foreach v_url in array v_urls loop
      v_req := net.http_get(
        url := 'https://r.jina.ai/'||v_url,
        headers := jsonb_build_object('User-Agent','Slevao/1.0','Accept','text/plain,text/markdown','X-With-Links-Summary','true'),
        timeout_milliseconds := 30000
      );
      insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
      values(v_req,j.store_id,'moebelix-sale-category-v1','pending',jsonb_build_object('run_id',j.metadata->>'run_id','source_url',v_url,'index_request_id',j.request_id));
    end loop;

    update public.structured_retail_http_jobs
      set status='completed',processed_at=v_now,error_message=null,
          metadata=metadata||jsonb_build_object('expected_categories',v_category_count,'category_urls',to_jsonb(v_urls),'index_http_status',coalesce(r.status_code,200),'index_html_length',length(coalesce(r.content,'')))
      where request_id=j.request_id;
    v_done:=v_done+1;
  end loop;

  for j in
    select * from public.structured_retail_http_jobs
    where adapter='moebelix-sale-category-v1' and status='pending'
    order by requested_at
    limit 100
  loop
    select * into r from net._http_response where id=j.request_id;
    if not found then
      if j.requested_at<v_now-interval '20 minutes' then
        v_msg := 'Möbelix SALE kategorie: timeout zdroje.';
        update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message=v_msg where request_id=j.request_id;
        v_failed:=v_failed+1;
      end if;
      continue;
    end if;

    if coalesce(r.status_code,0)<>200 or r.timed_out or r.error_msg is not null or length(coalesce(r.content,''))<8000
       or lower(coalesce(r.content,'')) like '%just a moment%' or lower(coalesce(r.content,'')) like '%access denied%'
       or lower(coalesce(r.content,'')) like '%human verification%' or lower(coalesce(r.content,'')) like '%captcha%'
       or coalesce(r.content,'') not like '%produktů%' then
      v_msg := format('Möbelix SALE kategorie: neplatná odpověď HTTP %s / length %s.',coalesce(r.status_code,0),length(coalesce(r.content,'')));
      update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message=v_msg where request_id=j.request_id;
      v_failed:=v_failed+1;
      continue;
    end if;

    select count(*) into v_parsed from public.parse_moebelix_sale_category_markdown(r.content);
    update public.structured_retail_http_jobs
      set status='completed',processed_at=v_now,error_message=null,
          metadata=metadata||jsonb_build_object('http_status',coalesce(r.status_code,200),'html_length',length(coalesce(r.content,'')),'strict_rows',coalesce(v_parsed,0))
      where request_id=j.request_id;
    v_done:=v_done+1;
  end loop;

  for runrec in
    select i.request_id as index_request_id,i.store_id,i.metadata->>'run_id' as run_id,
           coalesce((i.metadata->>'expected_categories')::int,0) as expected_categories,
           count(c.request_id)::int as category_jobs,
           count(c.request_id) filter(where c.status='pending')::int as pending_categories,
           count(c.request_id) filter(where c.status='failed')::int as failed_categories,
           count(c.request_id) filter(where c.status='completed')::int as completed_categories
    from public.structured_retail_http_jobs i
    left join public.structured_retail_http_jobs c on c.adapter='moebelix-sale-category-v1' and c.metadata->>'run_id'=i.metadata->>'run_id'
    where i.adapter='moebelix-sale-index-v1' and i.status='completed' and coalesce((i.metadata->>'published')::boolean,false)=false
    group by i.request_id,i.store_id,i.metadata
    order by i.request_id
    limit 5
  loop
    if runrec.pending_categories>0 then continue; end if;

    if runrec.failed_categories>0 or runrec.category_jobs<>runrec.expected_categories or runrec.completed_categories<>runrec.expected_categories then
      v_msg := format('Möbelix SALE run neúplný: očekáváno %s kategorií, completed %s, failed %s.',runrec.expected_categories,runrec.completed_categories,runrec.failed_categories);
      update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message=v_msg,metadata=metadata||jsonb_build_object('published',false,'final_result','incomplete_categories') where request_id=runrec.index_request_id;
      update public.store_product_sync_state set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,health_status='error',health_reason=v_msg,updated_at=v_now where store_id=runrec.store_id;
      update public.leaflet_sources set last_checked_at=v_now,last_error=v_msg,updated_at=v_now where store_id=runrec.store_id and is_active=true;
      v_failed:=v_failed+1;
      continue;
    end if;

    with raw as (
      select p.*
      from public.structured_retail_http_jobs c
      join net._http_response rr on rr.id=c.request_id
      cross join lateral public.parse_moebelix_sale_category_markdown(rr.content) p
      where c.adapter='moebelix-sale-category-v1' and c.status='completed' and c.metadata->>'run_id'=runrec.run_id
    ), grouped as (
      select external_id,min(title) as title,min(normalized_title) as normalized_title,min(price) as price,min(old_price) as old_price,
             min(discount_percent) as discount_percent,min(source_url) as source_url,min(image_url) as image_url,min(moebelix_product_id) as moebelix_product_id,
             count(distinct price) as price_versions,count(distinct old_price) as old_price_versions,count(distinct discount_percent) as discount_versions,count(distinct source_url) as url_versions
      from raw group by external_id
    )
    select jsonb_agg(jsonb_build_object(
             'external_id',external_id,'title',title,'normalized_title',normalized_title,'quantity_text',null,'price',price,'old_price',old_price,
             'valid_from',v_today,'valid_to',v_today,'source_url',source_url,'source_page',1,'product_id',null,'image_url',image_url,'confidence',0.99,
             'metadata',jsonb_build_object('adapter','moebelix-jina-sale-categories-v1','parser_version','moebelix-jina-sale-categories-v1','moebelix_product_id',moebelix_product_id,'discount_percent',discount_percent,'coverage_scope','all_sale_categories_strict_identity','price_policy','consumer_price_including_vat','validity_policy','daily_verified_snapshot')
           ) order by external_id) filter(where price_versions=1 and old_price_versions=1 and discount_versions=1 and url_versions=1),
           count(*) filter(where price_versions=1 and old_price_versions=1 and discount_versions=1 and url_versions=1),
           count(*) filter(where price_versions<>1 or old_price_versions<>1 or discount_versions<>1 or url_versions<>1),
           md5(string_agg(external_id||'|'||price::text||'|'||old_price::text||'|'||discount_percent::text||'|'||source_url,E'\n' order by external_id) filter(where price_versions=1 and old_price_versions=1 and discount_versions=1 and url_versions=1))
    into v_rows,v_count,v_conflicts,v_signature
    from grouped;

    if coalesce(v_conflicts,0)>0 then
      v_msg := format('Möbelix SALE: %s produktových identit má konfliktní cenu nebo URL; publikace zastavena.',v_conflicts);
      update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message=v_msg,metadata=metadata||jsonb_build_object('published',false,'final_result','identity_conflict') where request_id=runrec.index_request_id;
      update public.store_product_sync_state set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,health_status='error',health_reason=v_msg,last_product_candidates=coalesce(v_count,0),updated_at=v_now where store_id=runrec.store_id;
      v_failed:=v_failed+1;
      continue;
    end if;

    if coalesce(v_count,0)<60 or coalesce(v_count,0)>250 then
      v_msg := format('Möbelix parser vytvořil %s unikátních nabídek; bezpečný rozsah je 60–250.',coalesce(v_count,0));
      update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message=v_msg,metadata=metadata||jsonb_build_object('published',false,'final_result','unsafe_offer_count','offer_count',coalesce(v_count,0)) where request_id=runrec.index_request_id;
      update public.store_product_sync_state set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,health_status='error',health_reason=v_msg,last_product_candidates=coalesce(v_count,0),updated_at=v_now where store_id=runrec.store_id;
      v_failed:=v_failed+1;
      continue;
    end if;

    select coalesce(sum(length(coalesce(rr.content,''))),0)::int into v_total_html_length
    from public.structured_retail_http_jobs c join net._http_response rr on rr.id=c.request_id
    where c.adapter='moebelix-sale-category-v1' and c.status='completed' and c.metadata->>'run_id'=runrec.run_id;

    begin
      v_result := public.publish_structured_store_offers('moebelix','moebelix-jina-sale-categories-v1',v_signature,v_rows,60,250,'https://www.moebelix.cz/c/slevy','moebelix-jina-sale-categories-v1');
      update public.structured_retail_http_jobs set metadata=metadata||jsonb_build_object('published',true,'final_result','published','offer_count',v_count,'result',v_result),processed_at=v_now,error_message=null where request_id=runrec.index_request_id;
      update public.store_product_sync_state set is_running=false,run_started_at=null,last_error=null,last_parser_error=null,health_status='ok',
        health_reason=format('Automaticky publikováno %s ověřených SALE nabídek Möbelix z %s oficiálních kategorií.',v_count,runrec.expected_categories),
        last_http_status=200,last_html_length=v_total_html_length,last_product_candidates=v_count,last_published_count=v_count,last_valid_from=v_today,last_valid_to=v_today,
        coverage_scope='all_sale_categories_strict_identity',source_category='sale',minimum_offer_count=60,expected_offer_count=v_count,count_tolerance_percent=50,
        adapter_name='moebelix-jina-sale-categories-v1',adapter_version='moebelix-jina-sale-categories-v1',parser_version='moebelix-jina-sale-categories-v1',source_type='official-structured',updated_at=v_now
      where store_id=runrec.store_id;
      v_done:=v_done+1;
    exception when others then
      v_msg := 'Möbelix publikace selhala: '||sqlerrm;
      update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message=v_msg,metadata=metadata||jsonb_build_object('published',false,'final_result','publish_error') where request_id=runrec.index_request_id;
      update public.store_product_sync_state set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,health_status='error',health_reason=v_msg,last_product_candidates=coalesce(v_count,0),updated_at=v_now where store_id=runrec.store_id;
      v_failed:=v_failed+1;
    end;
  end loop;

  return jsonb_build_object('ok',v_failed=0,'completed',v_done,'failed',v_failed);
end;
$function$;

revoke all on function public.parse_moebelix_sale_category_markdown(text) from public, anon, authenticated;
revoke all on function public.trigger_moebelix_verified_sync() from public, anon, authenticated;
revoke all on function public.reconcile_moebelix_verified_sync() from public, anon, authenticated;

do $source$
declare
  v_store uuid;
  v_source uuid;
begin
  select id into v_store from public.stores where slug='moebelix';
  if v_store is null then return; end if;

  select id into v_source from public.leaflet_sources where store_id=v_store order by created_at,id limit 1;
  update public.leaflet_sources set is_active=false,auto_publish=false,updated_at=now() where store_id=v_store;

  if v_source is null then
    insert into public.leaflet_sources(store_id,name,source_url,source_type,is_active,auto_publish,check_interval_minutes,coverage_scope,automation_mode,adapter_key,extraction_strategy,manual_fallback_enabled,last_error,disabled_reason,updated_at)
    values(v_store,'Möbelix – oficiální SALE kategorie','https://www.moebelix.cz/c/slevy','html',true,true,360,'national','dedicated','moebelix-jina-sale-categories-v1','structured_markdown',false,null,null,now());
  else
    update public.leaflet_sources set name='Möbelix – oficiální SALE kategorie',source_url='https://www.moebelix.cz/c/slevy',source_type='html',is_active=true,auto_publish=true,
      check_interval_minutes=360,coverage_scope='national',automation_mode='dedicated',adapter_key='moebelix-jina-sale-categories-v1',extraction_strategy='structured_markdown',manual_fallback_enabled=false,
      last_error=null,disabled_reason=null,next_review_at=null,updated_at=now() where id=v_source;
  end if;
end;
$source$;

do $cron$
declare j record;
begin
  for j in select jobid from cron.job where jobname in ('sync-moebelix-verified-products','reconcile-moebelix-verified-products') loop
    perform cron.unschedule(j.jobid);
  end loop;
  perform cron.schedule('sync-moebelix-verified-products','29 */6 * * *','select public.trigger_moebelix_verified_sync();');
  perform cron.schedule('reconcile-moebelix-verified-products','2-57/5 * * * *','select public.reconcile_moebelix_verified_sync();');
end;
$cron$;

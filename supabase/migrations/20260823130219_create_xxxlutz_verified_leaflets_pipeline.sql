create or replace function public.parse_xxxlutz_leaflets_markdown(
  p_markdown text,
  p_snapshot_date date
)
returns table(
  external_id text,
  title text,
  normalized_title text,
  price numeric,
  old_price numeric,
  discount_percent integer,
  valid_from date,
  valid_to date,
  source_url text,
  image_url text,
  xxxlutz_product_key text
)
language sql
stable
set search_path = public, pg_temp
as $function$
with src as (
  select replace(replace(coalesce(p_markdown,''), chr(160), ' '), ' ', ' ') as c
), cards0 as (
  select
    ord,
    trim(split_part((m)[3], ' - ', 1)) as raw_title,
    replace((m)[2], ' ', '')::numeric as price,
    replace((m)[1], ' ', '')::numeric as old_price,
    (m)[5]::integer as discount_percent,
    (m)[4] as image_url
  from src,
       lateral regexp_matches(
         c,
         E'~~místo ([0-9][0-9 ]*),‒Kč\\*\\*~~\\n\\n([0-9][0-9 ]*),‒ Kč\\n\\nvč[.] DPH\\n\\nplus\\n\\n!\\[Image [0-9]+: ([^]]+)\\]\\((https://media[.]xxxlutz[.]com/[^ )]+)\\)\\n\\nSLEVA ([0-9]+)%',
         'g'
       ) with ordinality z(m,ord)
), cards as (
  select
    ord,
    regexp_replace(raw_title, '[[:space:],]+$', '', 'g') as title,
    public.normalize_product_name(raw_title) as match_key,
    price,
    old_price,
    discount_percent,
    image_url,
    row_number() over (
      partition by public.normalize_product_name(raw_title)
      order by ord
    ) as key_rn
  from cards0
  where price > 0
    and old_price > price
    and discount_percent between 5 and 90
    and image_url like 'https://media.xxxlutz.com/%'
), lines as (
  select ord,line
  from src,
       lateral regexp_split_to_table(c,E'\\n') with ordinality t(line,ord)
), urls0 as (
  select
    ord,
    trim((m)[1]) as link_title,
    (m)[2] as url,
    substring((m)[2] from '-([0-9A-Za-z]+)$') as product_key
  from lines,
       lateral regexp_match(
         line,
         E'^- \\[([^]]+)\\]\\((https://www[.]xxxlutz[.]cz/p/[^ )]+)\\)$'
       ) m
  where m is not null
), urls as (
  select
    ord,
    public.normalize_product_name(link_title) as match_key,
    url,
    product_key,
    row_number() over (
      partition by public.normalize_product_name(link_title)
      order by ord
    ) as key_rn
  from urls0
  where product_key is not null
)
select
  'xxxlutz:' || u.product_key,
  c.title,
  public.normalize_product_name(c.title),
  c.price,
  c.old_price,
  c.discount_percent,
  p_snapshot_date,
  p_snapshot_date,
  u.url,
  c.image_url,
  u.product_key
from cards c
join urls u using(match_key,key_rn)
where p_snapshot_date is not null
  and u.url like 'https://www.xxxlutz.cz/p/%';
$function$;

create or replace function public.trigger_xxxlutz_verified_sync()
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
  select id into v_store from public.stores where slug='xxxlutz';
  if v_store is null then return null; end if;

  if exists(
    select 1
    from public.structured_retail_http_jobs
    where store_id=v_store
      and adapter='xxxlutz-leaflets-frontpage-v1'
      and status='pending'
      and requested_at>v_now-interval '20 minutes'
  ) then
    return null;
  end if;

  v_req := net.http_get(
    url := 'https://r.jina.ai/https://www.xxxlutz.cz/c/letaky',
    headers := jsonb_build_object(
      'User-Agent','Slevao/1.0',
      'Accept','text/plain,text/markdown',
      'X-With-Links-Summary','true'
    ),
    timeout_milliseconds := 30000
  );

  insert into public.structured_retail_http_jobs(
    request_id,store_id,adapter,status,metadata
  ) values (
    v_req,v_store,'xxxlutz-leaflets-frontpage-v1','pending',
    jsonb_build_object(
      'run_id',v_run,
      'source_url','https://www.xxxlutz.cz/c/letaky',
      'coverage_scope','leaflets_frontpage_discount_cards_daily_verified'
    )
  );

  update public.store_product_sync_state
  set last_run_at=v_now,
      is_running=true,
      run_started_at=v_now,
      health_status='running',
      health_reason='XXXLutz: načítám ověřené slevové karty z aktuální stránky letáků.',
      last_error=null,
      last_parser_error=null,
      adapter_name='xxxlutz-jina-leaflets-v1',
      adapter_version='xxxlutz-jina-leaflets-v1',
      source_type='official-structured',
      source_category='leaflets',
      coverage_scope='leaflets_frontpage_discount_cards_daily_verified',
      minimum_offer_count=8,
      expected_offer_count=12,
      count_tolerance_percent=50,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'mode','dedicated_official_leaflets_frontpage',
        'source_url','https://www.xxxlutz.cz/c/letaky',
        'fetch_via','jina_reader_links_summary',
        'validity_policy','daily_verified_snapshot'
      ),
      updated_at=v_now
  where store_id=v_store;

  return v_req;
end;
$function$;

create or replace function public.reconcile_xxxlutz_verified_sync()
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
  v_signature text;
  v_result jsonb;
  v_done int := 0;
  v_failed int := 0;
  v_msg text;
begin
  for j in
    select *
    from public.structured_retail_http_jobs
    where adapter='xxxlutz-leaflets-frontpage-v1'
      and status='pending'
    order by requested_at
    limit 5
  loop
    select * into r from net._http_response where id=j.request_id;

    if not found then
      if j.requested_at<v_now-interval '20 minutes' then
        v_msg := 'XXXLutz letáky: timeout zdroje.';
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
       or length(coalesce(r.content,''))<15000
       or lower(coalesce(r.content,'')) like '%human verification%'
       or lower(coalesce(r.content,'')) like '%performing security verification%'
       or lower(coalesce(r.content,'')) like '%just a moment%'
       or lower(coalesce(r.content,'')) like '%title: 404 xxxlutz%' then
      v_msg := format(
        'XXXLutz letáky: neplatná odpověď HTTP %s / length %s.',
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

    select
      jsonb_agg(
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
          'image_url',p.image_url,
          'confidence',0.99,
          'metadata',jsonb_build_object(
            'adapter','xxxlutz-jina-leaflets-v1',
            'parser_version','xxxlutz-jina-leaflets-v1',
            'xxxlutz_product_key',p.xxxlutz_product_key,
            'discount_percent',p.discount_percent,
            'coverage_scope','leaflets_frontpage_discount_cards_daily_verified',
            'validity_policy','daily_verified_snapshot',
            'price_policy','consumer_price_including_vat'
          )
        ) order by p.external_id
      ),
      count(*),
      count(distinct p.external_id),
      md5(string_agg(
        p.external_id||'|'||p.price::text||'|'||p.old_price::text||'|'||p.image_url,
        E'\n' order by p.external_id
      ))
    into v_rows,v_count,v_distinct,v_signature
    from public.parse_xxxlutz_leaflets_markdown(r.content,v_today) p;

    if coalesce(v_count,0)<8
       or coalesce(v_count,0)>20
       or v_distinct<>v_count then
      v_msg := format(
        'XXXLutz parser vytvořil %s nabídek (%s unikátních); bezpečný rozsah je 8–20.',
        coalesce(v_count,0),coalesce(v_distinct,0)
      );
      update public.structured_retail_http_jobs
        set status='failed',processed_at=v_now,error_message=v_msg
        where request_id=j.request_id;
      update public.store_product_sync_state
        set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,
            health_status='error',health_reason=v_msg,last_product_candidates=coalesce(v_count,0),
            last_http_status=coalesce(r.status_code,200),last_html_length=length(coalesce(r.content,'')),
            updated_at=v_now
        where store_id=j.store_id;
      v_failed:=v_failed+1;
      continue;
    end if;

    begin
      v_result := public.publish_structured_store_offers(
        'xxxlutz',
        'xxxlutz-jina-leaflets-v1',
        v_signature,
        v_rows,
        8,
        20,
        'https://www.xxxlutz.cz/c/letaky',
        'xxxlutz-jina-leaflets-v1'
      );

      update public.structured_retail_http_jobs
        set status='completed',processed_at=v_now,error_message=null,
            metadata=metadata||jsonb_build_object(
              'result',v_result,'published',true,'offer_count',v_count
            )
        where request_id=j.request_id;

      update public.store_product_sync_state
        set is_running=false,run_started_at=null,last_error=null,last_parser_error=null,
            health_status='ok',
            health_reason=format('Automaticky publikováno %s denně ověřených slevových nabídek XXXLutz.',v_count),
            last_http_status=coalesce(r.status_code,200),
            last_html_length=length(coalesce(r.content,'')),
            last_product_candidates=v_count,
            last_offer_count=v_count,
            last_published_count=v_count,
            last_success_at=v_now,
            last_valid_from=v_today,
            last_valid_to=v_today,
            last_signature=v_signature,
            last_checksum=v_signature,
            updated_at=v_now
        where store_id=j.store_id;

      update public.leaflet_sources
        set last_checked_at=v_now,last_success_at=v_now,last_error=null,
            last_strategy_used='structured_markdown',last_strategy_success_at=v_now,
            updated_at=v_now
        where store_id=j.store_id
          and source_url='https://www.xxxlutz.cz/c/letaky';

      v_done:=v_done+1;
    exception when others then
      v_msg := sqlerrm;
      update public.structured_retail_http_jobs
        set status='failed',processed_at=v_now,error_message=v_msg
        where request_id=j.request_id;
      update public.store_product_sync_state
        set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,
            health_status='error',health_reason=v_msg,last_product_candidates=coalesce(v_count,0),
            updated_at=v_now
        where store_id=j.store_id;
      v_failed:=v_failed+1;
    end;
  end loop;

  return jsonb_build_object('ok',v_failed=0,'completed',v_done,'failed',v_failed);
end;
$function$;

revoke all on function public.parse_xxxlutz_leaflets_markdown(text,date) from public,anon,authenticated;
revoke all on function public.trigger_xxxlutz_verified_sync() from public,anon,authenticated;
revoke all on function public.reconcile_xxxlutz_verified_sync() from public,anon,authenticated;

update public.leaflet_sources ls
set source_url='https://www.xxxlutz.cz/c/letaky',
    name='XXXLutz – aktuální letáky',
    source_type='html',
    is_active=true,
    auto_publish=false,
    automation_mode='dedicated',
    adapter_key='xxxlutz-jina-leaflets-v1',
    extraction_strategy='structured_markdown',
    last_error=null,
    disabled_reason=null,
    updated_at=now()
from public.stores s
where ls.store_id=s.id
  and s.slug='xxxlutz'
  and ls.source_url='https://www.xxxlutz.cz/c/letak';

insert into public.leaflet_sources(
  store_id,name,source_url,source_type,is_active,auto_publish,
  automation_mode,adapter_key,extraction_strategy,
  check_interval_minutes,last_error,disabled_reason
)
select
  s.id,'XXXLutz – aktuální letáky','https://www.xxxlutz.cz/c/letaky','html',true,false,
  'dedicated','xxxlutz-jina-leaflets-v1','structured_markdown',360,null,null
from public.stores s
where s.slug='xxxlutz'
  and not exists(
    select 1 from public.leaflet_sources ls
    where ls.store_id=s.id
      and ls.source_url='https://www.xxxlutz.cz/c/letaky'
  );

do $block$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='sync-xxxlutz-verified-products' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'sync-xxxlutz-verified-products',
    '21 */6 * * *',
    'select public.trigger_xxxlutz_verified_sync();'
  );

  v_job := null;
  select jobid into v_job from cron.job where jobname='reconcile-xxxlutz-verified-products' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'reconcile-xxxlutz-verified-products',
    '3-58/5 * * * *',
    'select public.reconcile_xxxlutz_verified_sync();'
  );
end;
$block$;

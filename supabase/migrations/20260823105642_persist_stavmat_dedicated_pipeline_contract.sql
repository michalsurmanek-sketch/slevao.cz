create or replace function public.parse_stavmat_promo_html(p_html text)
returns table(external_id text, title text, normalized_title text, quantity_text text, price numeric, old_price numeric, valid_from date, valid_to date, source_url text, image_url text, metadata jsonb)
language sql
stable
set search_path to 'public','pg_temp'
as $function$
with page_meta as (
  select substring(coalesce(p_html,'') from 'platnou do[[:space:]]*([0-9]{2}[.][0-9]{2}[.][0-9]{4})') full_to_text
), blocks as (
  select ord,block from regexp_split_to_table(coalesce(p_html,''), '<article class="products-teaser" data-id="') with ordinality x(block,ord) where ord>1
), e as (
  select ord,
    substring(block from '^([0-9]+)"') pid,
    substring(block from '<a href="(https://www.stavmat.cz/produkty/[^"]+)"') href,
    substring(block from 'data-srcset="(https://www.stavmat.cz/[^ "?]+)') image,
    trim(regexp_replace(coalesce(substring(block from '<h3 class="h4 mb-1">[[:space:]]*([^<]+)</h3>'),''),'[[:space:]]+',' ','g')) raw_title,
    nullif(replace(regexp_replace(coalesce(substring(block from '<span class="text-primary price">[[:space:]]*<small>[^<]*</small>[[:space:]]*([^<]+)</span>'),''),'[^0-9,]','','g'),',','.'),'')::numeric net_price,
    nullif(replace(regexp_replace(coalesce(substring(block from '<span></span>[[:space:]]*([^<]+)<br>cena za'),''),'[^0-9,]','','g'),',','.'),'')::numeric gross_price,
    substring(block from 'text-primary products-teaser-status">[[:space:]]*od[[:space:]]*([0-9]{2}[.][0-9]{2}[.])[[:space:]]*do') from_dm
  from blocks
), d as (
  select e.*,case when pm.full_to_text is not null then to_date(pm.full_to_text,'DD.MM.YYYY') end page_to
  from e cross join page_meta pm
), n as (
  select *,trim(replace(replace(replace(raw_title,'&amp;','&'),'&quot;','"'),'&nbsp;',' ')) clean_title,
    case when page_to is not null and from_dm is not null then
      case when to_date(from_dm||extract(year from page_to)::int::text,'DD.MM.YYYY')<=page_to
        then to_date(from_dm||extract(year from page_to)::int::text,'DD.MM.YYYY')
        else to_date(from_dm||(extract(year from page_to)::int-1)::text,'DD.MM.YYYY') end
    end from_date
  from d
), ranked as (
  select *,row_number() over(partition by pid order by ord) rn from n
  where pid~'^[0-9]+$' and href is not null and length(clean_title) between 4 and 180
    and gross_price between 1 and 1000000 and net_price between 1 and 1000000 and gross_price>=net_price
    and from_date is not null and page_to is not null and from_date<=page_to
)
select 'stavmat:'||pid,clean_title,public.normalize_product_name(clean_title),null::text,gross_price,null::numeric,from_date,page_to,href,image,
jsonb_strip_nulls(jsonb_build_object('adapter','stavmat-official-promo-html-v1','stavmat_product_id',pid,'net_price',net_price,'gross_price',gross_price,'price_policy','consumer_price_including_vat','official_product_url',href))
from ranked where rn=1;
$function$;

create or replace function public.request_stavmat_homepage()
returns bigint
language plpgsql
set search_path to 'public','private','net','pg_temp'
as $function$
declare v_id bigint;
begin
  v_id:=net.http_get(
    url:='https://www.stavmat.cz/',
    headers:=jsonb_build_object('user-agent','Mozilla/5.0','accept','text/html','accept-language','cs-CZ,cs;q=0.9'),
    timeout_milliseconds:=30000
  );
  insert into private.store_sync_http_queue(store_slug,phase,request_id,source_url,created_at)
  values('stavmat','homepage',v_id,'https://www.stavmat.cz/',now())
  on conflict(store_slug,phase) do update set request_id=excluded.request_id,source_url=excluded.source_url,created_at=excluded.created_at;
  return v_id;
end;
$function$;

create or replace function public.request_stavmat_current_promo()
returns bigint
language plpgsql
set search_path to 'public','private','net','pg_temp'
as $function$
declare
  v_home_id bigint;
  v_html text;
  v_url text;
  v_id bigint;
  v_last_valid_to date;
  v_today date := (now() at time zone 'Europe/Prague')::date;
begin
  select request_id into v_home_id
  from private.store_sync_http_queue
  where store_slug='stavmat' and phase='homepage' and created_at>now()-interval '6 hours';

  if v_home_id is null then
    raise exception 'Fresh STAVMAT homepage request missing';
  end if;

  select content into v_html
  from net._http_response
  where id=v_home_id and status_code=200 and not timed_out;

  if v_html is null then
    raise exception 'STAVMAT homepage response is not ready or failed';
  end if;

  v_url := substring(
    v_html
    from $re$href=["'](https://www[.]stavmat[.]cz/akcni-nabidka-[^"']+/|/akcni-nabidka-[^"']+/)["']$re$
  );

  if v_url like '/%' then
    v_url := 'https://www.stavmat.cz' || v_url;
  end if;

  if v_url is null then
    select max(li.detected_valid_to)
    into v_last_valid_to
    from public.leaflet_imports li
    where li.store_id=(select id from public.stores where slug='stavmat');

    if v_last_valid_to is not null and v_last_valid_to < v_today then
      update public.store_product_sync_state
      set health_status='waiting_source',
          health_reason=format(
            'STAVMAT: poslední zveřejněná akce skončila %s; čekáme na novou kampaň.',
            to_char(v_last_valid_to,'DD.MM.YYYY')
          ),
          last_error=null,
          last_parser_error=null,
          last_run_at=now(),
          is_running=false,
          run_started_at=null,
          updated_at=now()
      where store_id=(select id from public.stores where slug='stavmat');

      update public.leaflet_sources
      set last_checked_at=now(),
          last_error=null
      where store_id=(select id from public.stores where slug='stavmat')
        and name='STAVMAT aktuální akční nabídka';

      return null;
    end if;

    raise exception 'Current STAVMAT action URL not found';
  end if;

  v_id:=net.http_get(
    url:=v_url,
    headers:=jsonb_build_object(
      'user-agent','Mozilla/5.0',
      'accept','text/html',
      'accept-language','cs-CZ,cs;q=0.9'
    ),
    timeout_milliseconds:=30000
  );

  insert into private.store_sync_http_queue(store_slug,phase,request_id,source_url,created_at)
  values('stavmat','promo',v_id,v_url,now())
  on conflict(store_slug,phase) do update
  set request_id=excluded.request_id,
      source_url=excluded.source_url,
      created_at=excluded.created_at;

  return v_id;
end;
$function$;

create or replace function public.apply_stavmat_latest_promo()
returns jsonb
language plpgsql
set search_path to 'public','private','net','extensions','pg_temp'
as $function$
declare
  v_request_id bigint;
  v_source_url text;
  v_html text;
  v_rows jsonb;
  v_signature text;
  v_count int;
  v_result jsonb;
  v_page_to date;
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_health_status text;
begin
  select request_id,source_url into v_request_id,v_source_url
  from private.store_sync_http_queue
  where store_slug='stavmat' and phase='promo' and created_at>now()-interval '6 hours';

  if v_request_id is null then
    select ss.health_status into v_health_status
    from public.store_product_sync_state ss
    where ss.store_id=(select id from public.stores where slug='stavmat');

    if v_health_status='waiting_source' then
      return jsonb_build_object(
        'ok',true,
        'waiting_source',true,
        'reason','no_current_campaign'
      );
    end if;

    raise exception 'Fresh STAVMAT promo request missing';
  end if;

  select content into v_html
  from net._http_response
  where id=v_request_id and status_code=200 and not timed_out;

  if v_html is null then
    raise exception 'STAVMAT promo response is not ready or failed';
  end if;

  begin
    v_page_to := to_date(
      substring(v_html from 'platnou do[[:space:]]*([0-9]{2}[.][0-9]{2}[.][0-9]{4})'),
      'DD.MM.YYYY'
    );
  exception when others then
    v_page_to := null;
  end;

  if v_page_to is not null and v_page_to < v_today then
    update public.store_product_sync_state
    set health_status='waiting_source',
        health_reason=format(
          'STAVMAT: poslední zveřejněná akce skončila %s; čekáme na novou kampaň.',
          to_char(v_page_to,'DD.MM.YYYY')
        ),
        last_error=null,
        last_parser_error=null,
        last_run_at=now(),
        is_running=false,
        run_started_at=null,
        updated_at=now()
    where store_id=(select id from public.stores where slug='stavmat');

    update public.leaflet_sources
    set last_checked_at=now(),
        last_error=null
    where store_id=(select id from public.stores where slug='stavmat')
      and name='STAVMAT aktuální akční nabídka';

    return jsonb_build_object(
      'ok',true,
      'waiting_source',true,
      'reason','expired_campaign',
      'valid_to',v_page_to,
      'source_url',v_source_url,
      'request_id',v_request_id
    );
  end if;

  select jsonb_agg(jsonb_build_object(
    'external_id',external_id,
    'title',title,
    'normalized_title',normalized_title,
    'quantity_text',quantity_text,
    'price',price,
    'old_price',old_price,
    'valid_from',valid_from,
    'valid_to',valid_to,
    'source_url',source_url,
    'source_page',null,
    'product_id',null,
    'image_url',image_url,
    'confidence',0.99,
    'metadata',metadata
  ) order by external_id),count(*)
  into v_rows,v_count
  from public.parse_stavmat_promo_html(v_html);

  if v_count<30 or v_count>150 then
    raise exception 'STAVMAT parser returned unsafe count %',v_count;
  end if;

  v_signature:=encode(extensions.digest(v_rows::text,'sha256'),'hex');

  select public.publish_structured_store_offers(
    'stavmat',
    'stavmat-official-promo-html-v1',
    v_signature,
    v_rows,
    30,
    150,
    v_source_url,
    'stavmat-official-promo-html-v1'
  ) into v_result;

  update public.leaflet_sources
  set source_url=v_source_url,
      last_checked_at=now(),
      last_success_at=now(),
      last_error=null,
      last_strategy_used='official_structured_products',
      last_strategy_success_at=now()
  where store_id=(select id from public.stores where slug='stavmat')
    and name='STAVMAT aktuální akční nabídka';

  return v_result||jsonb_build_object(
    'request_id',v_request_id,
    'safe_candidates',v_count,
    'source_url',v_source_url
  );
end;
$function$;

revoke all on function public.parse_stavmat_promo_html(text) from public,anon,authenticated;
revoke all on function public.request_stavmat_homepage() from public,anon,authenticated;
revoke all on function public.request_stavmat_current_promo() from public,anon,authenticated;
revoke all on function public.apply_stavmat_latest_promo() from public,anon,authenticated;
grant execute on function public.parse_stavmat_promo_html(text) to service_role;
grant execute on function public.request_stavmat_homepage() to service_role;
grant execute on function public.request_stavmat_current_promo() to service_role;
grant execute on function public.apply_stavmat_latest_promo() to service_role;

do $do$
begin
  if not exists(select 1 from cron.job where jobname='sync_stavmat_home_daily') then
    perform cron.schedule('sync_stavmat_home_daily','10 4 * * *','select public.request_stavmat_homepage();');
  end if;
  if not exists(select 1 from cron.job where jobname='sync_stavmat_promo_daily') then
    perform cron.schedule('sync_stavmat_promo_daily','12 4 * * *','select public.request_stavmat_current_promo();');
  end if;
  if not exists(select 1 from cron.job where jobname='sync_stavmat_apply_daily') then
    perform cron.schedule('sync_stavmat_apply_daily','14 4 * * *','select public.apply_stavmat_latest_promo();');
  end if;
end;
$do$;

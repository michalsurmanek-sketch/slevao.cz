create or replace function public.apply_stavmat_latest_promo()
returns jsonb
language plpgsql
set search_path to 'public', 'private', 'net', 'extensions', 'pg_temp'
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
begin
  select request_id,source_url into v_request_id,v_source_url
  from private.store_sync_http_queue
  where store_slug='stavmat' and phase='promo' and created_at>now()-interval '6 hours';
  if v_request_id is null then raise exception 'Fresh STAVMAT promo request missing'; end if;

  select content into v_html from net._http_response where id=v_request_id and status_code=200 and not timed_out;
  if v_html is null then raise exception 'STAVMAT promo response is not ready or failed'; end if;

  begin
    v_page_to := to_date(substring(v_html from 'platnou do[[:space:]]*([0-9]{2}[.][0-9]{2}[.][0-9]{4})'),'DD.MM.YYYY');
  exception when others then
    v_page_to := null;
  end;

  if v_page_to is not null and v_page_to < v_today then
    update public.store_product_sync_state
    set health_status='waiting_source',
        health_reason=format('STAVMAT: poslední zveřejněná akce skončila %s; čekáme na novou kampaň.',to_char(v_page_to,'DD.MM.YYYY')),
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
    'external_id',external_id,'title',title,'normalized_title',normalized_title,'quantity_text',quantity_text,
    'price',price,'old_price',old_price,'valid_from',valid_from,'valid_to',valid_to,'source_url',source_url,
    'source_page',null,'product_id',null,'image_url',image_url,'confidence',0.99,'metadata',metadata
  ) order by external_id),count(*)
  into v_rows,v_count
  from public.parse_stavmat_promo_html(v_html);

  if v_count<30 or v_count>150 then raise exception 'STAVMAT parser returned unsafe count %',v_count; end if;
  v_signature:=encode(extensions.digest(v_rows::text,'sha256'),'hex');
  select public.publish_structured_store_offers('stavmat','stavmat-official-promo-html-v1',v_signature,v_rows,30,150,v_source_url,'stavmat-official-promo-html-v1') into v_result;

  update public.leaflet_sources
  set source_url=v_source_url,last_checked_at=now(),last_success_at=now(),last_error=null,last_strategy_used='official_structured_products',last_strategy_success_at=now()
  where store_id=(select id from public.stores where slug='stavmat') and name='STAVMAT aktuální akční nabídka';

  return v_result||jsonb_build_object('request_id',v_request_id,'safe_candidates',v_count,'source_url',v_source_url);
end;
$function$;

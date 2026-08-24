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
  v_discount_markers int;
  v_signature text;
  v_result jsonb;
  v_done int := 0;
  v_failed int := 0;
  v_retry int;
  v_req bigint;
  v_source_url text;
  v_msg text;
begin
  for j in
    select *
    from public.structured_retail_http_jobs
    where adapter='xxxlutz-leaflets-frontpage-v1'
      and status='pending'
    order by requested_at
    limit 10
  loop
    v_retry := coalesce((j.metadata->>'retry_count')::int,0);
    v_source_url := coalesce(j.metadata->>'source_url','');

    select * into r from net._http_response where id=j.request_id;

    if not found then
      if j.requested_at<v_now-interval '20 minutes' then
        v_msg := 'XXXLutz letáky: timeout zdroje.';

        if v_retry<2 and v_source_url='https://www.xxxlutz.cz/c/letaky' then
          v_req := net.http_get(
            url := 'https://r.jina.ai/'||v_source_url,
            headers := jsonb_build_object(
              'User-Agent','Slevao/1.0',
              'Accept','text/plain,text/markdown',
              'X-With-Links-Summary','true'
            ),
            timeout_milliseconds := 30000
          );

          insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
          values(
            v_req,j.store_id,'xxxlutz-leaflets-frontpage-v1','pending',
            j.metadata||jsonb_build_object(
              'retry_count',v_retry+1,
              'retry_of_request_id',j.request_id
            )
          );

          update public.structured_retail_http_jobs
          set status='failed',processed_at=v_now,error_message=v_msg,
              metadata=metadata||jsonb_build_object(
                'retry_scheduled',true,
                'retry_request_id',v_req
              )
          where request_id=j.request_id;

          update public.store_product_sync_state
          set is_running=true,
              health_status='running',
              health_reason=format('XXXLutz: transientní fetch selhal, naplánován retry %s/2.',v_retry+1),
              last_error=v_msg,
              last_parser_error=null,
              updated_at=v_now
          where store_id=j.store_id;
        else
          update public.structured_retail_http_jobs
          set status='failed',processed_at=v_now,error_message=v_msg,
              metadata=metadata||jsonb_build_object('retry_exhausted',true)
          where request_id=j.request_id;

          update public.store_product_sync_state
          set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,
              health_status='error',health_reason=v_msg,updated_at=v_now
          where store_id=j.store_id;

          update public.leaflet_sources
          set last_checked_at=v_now,last_error=v_msg,updated_at=v_now
          where store_id=j.store_id
            and source_url='https://www.xxxlutz.cz/c/letaky';

          v_failed:=v_failed+1;
        end if;
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

      if v_retry<2 and v_source_url='https://www.xxxlutz.cz/c/letaky' then
        v_req := net.http_get(
          url := 'https://r.jina.ai/'||v_source_url,
          headers := jsonb_build_object(
            'User-Agent','Slevao/1.0',
            'Accept','text/plain,text/markdown',
            'X-With-Links-Summary','true'
          ),
          timeout_milliseconds := 30000
        );

        insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
        values(
          v_req,j.store_id,'xxxlutz-leaflets-frontpage-v1','pending',
          j.metadata||jsonb_build_object(
            'retry_count',v_retry+1,
            'retry_of_request_id',j.request_id
          )
        );

        update public.structured_retail_http_jobs
        set status='failed',processed_at=v_now,error_message=v_msg,
            metadata=metadata||jsonb_build_object(
              'retry_scheduled',true,
              'retry_request_id',v_req,
              'http_status',coalesce(r.status_code,0),
              'html_length',length(coalesce(r.content,''))
            )
        where request_id=j.request_id;

        update public.store_product_sync_state
        set is_running=true,
            health_status='running',
            health_reason=format('XXXLutz: transientní fetch selhal, naplánován retry %s/2.',v_retry+1),
            last_error=v_msg,
            last_parser_error=null,
            last_http_status=coalesce(r.status_code,0),
            last_html_length=length(coalesce(r.content,'')),
            updated_at=v_now
        where store_id=j.store_id;
      else
        update public.structured_retail_http_jobs
        set status='failed',processed_at=v_now,error_message=v_msg,
            metadata=metadata||jsonb_build_object(
              'retry_exhausted',true,
              'http_status',coalesce(r.status_code,0),
              'html_length',length(coalesce(r.content,''))
            )
        where request_id=j.request_id;

        update public.store_product_sync_state
        set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,
            health_status='error',health_reason=v_msg,last_http_status=coalesce(r.status_code,0),
            last_html_length=length(coalesce(r.content,'')),updated_at=v_now
        where store_id=j.store_id;

        update public.leaflet_sources
        set last_checked_at=v_now,last_error=v_msg,updated_at=v_now
        where store_id=j.store_id
          and source_url='https://www.xxxlutz.cz/c/letaky';

        v_failed:=v_failed+1;
      end if;
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

    select count(*)
    into v_discount_markers
    from regexp_matches(coalesce(r.content,''), 'SLEVA[[:space:]]+[0-9]+%', 'g');

    if coalesce(v_count,0)<4
       or coalesce(v_count,0)>20
       or v_distinct<>v_count
       or v_discount_markers<>v_count then
      v_msg := format(
        'XXXLutz parser vytvořil %s nabídek (%s unikátních) z %s SLEVA markerů; bezpečný rozsah je 4–20 a marker coverage musí být 100%%.',
        coalesce(v_count,0),coalesce(v_distinct,0),coalesce(v_discount_markers,0)
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
        4,
        20,
        'https://www.xxxlutz.cz/c/letaky',
        'xxxlutz-jina-leaflets-v1'
      );

      update public.structured_retail_http_jobs
        set status='completed',processed_at=v_now,error_message=null,
            metadata=metadata||jsonb_build_object(
              'result',v_result,'published',true,'offer_count',v_count,
              'discount_markers',v_discount_markers,'marker_coverage',1.0
            )
        where request_id=j.request_id;

      update public.store_product_sync_state
        set is_running=false,run_started_at=null,last_error=null,last_parser_error=null,
            health_status='ok',
            health_reason=format('Automaticky publikováno %s denně ověřených slevových nabídek XXXLutz; 100%% coverage SLEVA markerů.',v_count),
            last_http_status=coalesce(r.status_code,200),
            last_html_length=length(coalesce(r.content,'')),
            last_product_candidates=v_count,
            last_offer_count=v_count,
            last_published_count=v_count,
            last_success_at=v_now,
            last_valid_from=v_today,
            last_valid_to=v_today,
            last_source_signature=v_signature,
            last_checksum=v_signature,
            minimum_offer_count=4,
            expected_offer_count=v_count,
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
      'coverage_scope','leaflets_frontpage_discount_cards_daily_verified',
      'retry_count',0
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
      minimum_offer_count=4,
      expected_offer_count=coalesce(nullif(last_offer_count,0),6),
      count_tolerance_percent=50,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'mode','dedicated_official_leaflets_frontpage',
        'source_url','https://www.xxxlutz.cz/c/letaky',
        'fetch_via','jina_reader_links_summary',
        'validity_policy','daily_verified_snapshot',
        'discount_marker_coverage_required',1.0
      ),
      updated_at=v_now
  where store_id=v_store;

  return v_req;
end;
$function$;

revoke all on function public.trigger_xxxlutz_verified_sync() from public,anon,authenticated;
revoke all on function public.reconcile_xxxlutz_verified_sync() from public,anon,authenticated;

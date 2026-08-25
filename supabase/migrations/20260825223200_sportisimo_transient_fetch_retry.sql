create or replace function public.trigger_sportisimo_verified_sync()
returns bigint
language plpgsql
security definer
set search_path to 'public','net','pg_temp'
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
      'X-With-Links-Summary','true',
      'X-No-Cache','true',
      'Cache-Control','no-cache'
    ),
    timeout_milliseconds := 30000
  );

  insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
  values(
    v_req,v_store,'sportisimo-sale-frontpage-v1','pending',
    jsonb_build_object(
      'run_id',v_run,
      'source_url','https://www.sportisimo.cz/vyprodej/',
      'coverage_scope','sale_frontpage_strict_identity',
      'retry_count',0
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
        'fetch_via','jina_reader_links_summary',
        'transient_retry_limit',2
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
set search_path to 'public','net','pg_temp'
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
  v_retry int;
  v_retry_req bigint;
  v_source_url text;
begin
  for j in
    select * from public.structured_retail_http_jobs
    where adapter='sportisimo-sale-frontpage-v1' and status='pending'
    order by requested_at
    limit 5
  loop
    select * into r from net._http_response where id=j.request_id;
    v_retry := coalesce((j.metadata->>'retry_count')::int,0);
    v_source_url := coalesce(nullif(j.metadata->>'source_url',''),'https://www.sportisimo.cz/vyprodej/');

    if not found then
      if j.requested_at<v_now-interval '20 minutes' then
        v_msg := 'Sportisimo výprodej: timeout zdroje.';
        if v_retry < 2 then
          v_retry_req := net.http_get(
            url := 'https://r.jina.ai/'||v_source_url,
            headers := jsonb_build_object(
              'User-Agent','Slevao/1.0',
              'Accept','text/plain,text/markdown',
              'X-With-Links-Summary','true',
              'X-No-Cache','true',
              'Cache-Control','no-cache'
            ),
            timeout_milliseconds := 30000
          );
          insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
          values(
            v_retry_req,j.store_id,'sportisimo-sale-frontpage-v1','pending',
            coalesce(j.metadata,'{}'::jsonb)||jsonb_build_object(
              'retry_count',v_retry+1,
              'retry_of_request_id',j.request_id,
              'retry_reason','timeout'
            )
          );
          update public.structured_retail_http_jobs
             set status='failed',processed_at=v_now,error_message=v_msg,
                 metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('retry_scheduled',true,'retry_request_id',v_retry_req)
           where request_id=j.request_id;
          update public.store_product_sync_state
             set is_running=true,run_started_at=coalesce(run_started_at,v_now),last_error=null,last_parser_error=null,
                 health_status='running',health_reason=format('Sportisimo: transientní timeout, automatický retry %s/2.',v_retry+1),updated_at=v_now
           where store_id=j.store_id;
        else
          update public.structured_retail_http_jobs
             set status='failed',processed_at=v_now,error_message=v_msg,
                 metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('retry_exhausted',true)
           where request_id=j.request_id;
          update public.store_product_sync_state
             set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,
                 health_status='error',health_reason=v_msg,updated_at=v_now
           where store_id=j.store_id;
          v_failed:=v_failed+1;
        end if;
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
      if v_retry < 2 then
        v_retry_req := net.http_get(
          url := 'https://r.jina.ai/'||v_source_url,
          headers := jsonb_build_object(
            'User-Agent','Slevao/1.0',
            'Accept','text/plain,text/markdown',
            'X-With-Links-Summary','true',
            'X-No-Cache','true',
            'Cache-Control','no-cache'
          ),
          timeout_milliseconds := 30000
        );
        insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
        values(
          v_retry_req,j.store_id,'sportisimo-sale-frontpage-v1','pending',
          coalesce(j.metadata,'{}'::jsonb)||jsonb_build_object(
            'retry_count',v_retry+1,
            'retry_of_request_id',j.request_id,
            'retry_reason','invalid_response'
          )
        );
        update public.structured_retail_http_jobs
           set status='failed',processed_at=v_now,error_message=v_msg,
               metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('retry_scheduled',true,'retry_request_id',v_retry_req,'http_status',coalesce(r.status_code,0),'html_length',length(coalesce(r.content,'')))
         where request_id=j.request_id;
        update public.store_product_sync_state
           set is_running=true,run_started_at=coalesce(run_started_at,v_now),last_error=null,last_parser_error=null,
               health_status='running',health_reason=format('Sportisimo: krátká/neplatná odpověď zdroje, automatický retry %s/2.',v_retry+1),
               last_http_status=coalesce(r.status_code,0),last_html_length=length(coalesce(r.content,'')),updated_at=v_now
         where store_id=j.store_id;
      else
        update public.structured_retail_http_jobs
           set status='failed',processed_at=v_now,error_message=v_msg,
               metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('retry_exhausted',true,'http_status',coalesce(r.status_code,0),'html_length',length(coalesce(r.content,'')))
         where request_id=j.request_id;
        update public.store_product_sync_state
           set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,
               health_status='error',health_reason=v_msg,last_http_status=coalesce(r.status_code,0),
               last_html_length=length(coalesce(r.content,'')),updated_at=v_now
         where store_id=j.store_id;
        v_failed:=v_failed+1;
      end if;
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
      if v_retry < 2 then
        v_retry_req := net.http_get(
          url := 'https://r.jina.ai/'||v_source_url,
          headers := jsonb_build_object(
            'User-Agent','Slevao/1.0',
            'Accept','text/plain,text/markdown',
            'X-With-Links-Summary','true',
            'X-No-Cache','true',
            'Cache-Control','no-cache'
          ),
          timeout_milliseconds := 30000
        );
        insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
        values(
          v_retry_req,j.store_id,'sportisimo-sale-frontpage-v1','pending',
          coalesce(j.metadata,'{}'::jsonb)||jsonb_build_object(
            'retry_count',v_retry+1,
            'retry_of_request_id',j.request_id,
            'retry_reason','missing_validity'
          )
        );
        update public.structured_retail_http_jobs
           set status='failed',processed_at=v_now,error_message=v_msg,
               metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('retry_scheduled',true,'retry_request_id',v_retry_req,'parsed_candidates',coalesce(v_count,0))
         where request_id=j.request_id;
        update public.store_product_sync_state
           set is_running=true,run_started_at=coalesce(run_started_at,v_now),last_error=null,last_parser_error=null,
               health_status='running',health_reason=format('Sportisimo: neúplná platnost v odpovědi, automatický retry %s/2.',v_retry+1),
               last_product_candidates=coalesce(v_count,0),updated_at=v_now
         where store_id=j.store_id;
      else
        update public.structured_retail_http_jobs
           set status='failed',processed_at=v_now,error_message=v_msg,
               metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('retry_exhausted',true,'parsed_candidates',coalesce(v_count,0))
         where request_id=j.request_id;
        update public.store_product_sync_state
           set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,health_status='error',health_reason=v_msg,
               last_product_candidates=coalesce(v_count,0),updated_at=v_now
         where store_id=j.store_id;
        v_failed:=v_failed+1;
      end if;
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
            last_success_at=v_now,last_offer_count=v_count,last_published_count=v_count,
            last_valid_from=v_from,last_valid_to=v_to,last_http_status=coalesce(r.status_code,200),last_html_length=length(coalesce(r.content,'')),
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

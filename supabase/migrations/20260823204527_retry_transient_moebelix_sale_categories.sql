CREATE OR REPLACE FUNCTION public.reconcile_moebelix_verified_sync()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net', 'pg_temp'
AS $function$
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
  v_retry int;
  v_msg text;
begin
  -- Stage 1: validate the SALE index and fan out to every official SALE category.
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
        update public.structured_retail_http_jobs
          set status='failed',processed_at=v_now,error_message=v_msg
          where request_id=j.request_id;
        update public.store_product_sync_state
          set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,
              health_status='error',health_reason=v_msg,updated_at=v_now
          where store_id=j.store_id;
        update public.leaflet_sources
          set last_checked_at=v_now,last_error=v_msg,updated_at=v_now
          where store_id=j.store_id and is_active=true;
        v_failed:=v_failed+1;
      end if;
      continue;
    end if;

    if coalesce(r.status_code,0)<>200
       or r.timed_out
       or r.error_msg is not null
       or length(coalesce(r.content,''))<10000
       or lower(coalesce(r.content,'')) like '%just a moment%'
       or lower(coalesce(r.content,'')) like '%access denied%'
       or lower(coalesce(r.content,'')) like '%human verification%'
       or lower(coalesce(r.content,'')) like '%captcha%' then
      v_msg := format('Möbelix SALE index: neplatná odpověď HTTP %s / length %s.',coalesce(r.status_code,0),length(coalesce(r.content,'')));
      update public.structured_retail_http_jobs
        set status='failed',processed_at=v_now,error_message=v_msg
        where request_id=j.request_id;
      update public.store_product_sync_state
        set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,
            health_status='error',health_reason=v_msg,last_http_status=coalesce(r.status_code,0),
            last_html_length=length(coalesce(r.content,'')),updated_at=v_now
        where store_id=j.store_id;
      update public.leaflet_sources
        set last_checked_at=v_now,last_error=v_msg,updated_at=v_now
        where store_id=j.store_id and is_active=true;
      v_failed:=v_failed+1;
      continue;
    end if;

    select array_agg(q.url order by q.url),count(*)
    into v_urls,v_category_count
    from (
      select distinct (m)[1] as url
      from regexp_matches(
        r.content,
        '(https://www[.]moebelix[.]cz/[^ )]+[?]p_eyecatcher=[^ )]+)',
        'g'
      ) as z(m)
      where (m)[1] like 'https://www.moebelix.cz/%'
    ) q;

    if coalesce(v_category_count,0)<8 or v_category_count>15 then
      v_msg := format('Möbelix SALE index obsahuje %s kategorií; bezpečný rozsah je 8–15.',coalesce(v_category_count,0));
      update public.structured_retail_http_jobs
        set status='failed',processed_at=v_now,error_message=v_msg
        where request_id=j.request_id;
      update public.store_product_sync_state
        set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,
            health_status='error',health_reason=v_msg,last_http_status=coalesce(r.status_code,200),
            last_html_length=length(coalesce(r.content,'')),updated_at=v_now
        where store_id=j.store_id;
      v_failed:=v_failed+1;
      continue;
    end if;

    foreach v_url in array v_urls
    loop
      v_req := net.http_get(
        url := 'https://r.jina.ai/'||v_url,
        headers := jsonb_build_object(
          'User-Agent','Slevao/1.0',
          'Accept','text/plain,text/markdown',
          'X-With-Links-Summary','true'
        ),
        timeout_milliseconds := 30000
      );

      insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
      values(
        v_req,j.store_id,'moebelix-sale-category-v1','pending',
        jsonb_build_object(
          'run_id',j.metadata->>'run_id',
          'source_url',v_url,
          'index_request_id',j.request_id,
          'retry_count',0
        )
      );
    end loop;

    update public.structured_retail_http_jobs
      set status='completed',processed_at=v_now,error_message=null,
          metadata=metadata||jsonb_build_object(
            'expected_categories',v_category_count,
            'category_urls',to_jsonb(v_urls),
            'index_http_status',coalesce(r.status_code,200),
            'index_html_length',length(coalesce(r.content,''))
          )
      where request_id=j.request_id;

    v_done:=v_done+1;
  end loop;

  -- Stage 2: validate every category response independently. Transient failures are retried twice.
  for j in
    select *
    from public.structured_retail_http_jobs
    where adapter='moebelix-sale-category-v1' and status='pending'
    order by requested_at
    limit 100
  loop
    select * into r from net._http_response where id=j.request_id;
    v_retry := coalesce((j.metadata->>'retry_count')::int,0);

    if not found then
      if j.requested_at<v_now-interval '20 minutes' then
        v_msg := 'Möbelix SALE kategorie: timeout zdroje.';
        if v_retry<2 and coalesce(j.metadata->>'source_url','') like 'https://www.moebelix.cz/%' then
          v_req := net.http_get(
            url := 'https://r.jina.ai/'||(j.metadata->>'source_url'),
            headers := jsonb_build_object('User-Agent','Slevao/1.0','Accept','text/plain,text/markdown','X-With-Links-Summary','true'),
            timeout_milliseconds := 30000
          );
          insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
          values(
            v_req,j.store_id,'moebelix-sale-category-v1','pending',
            jsonb_build_object(
              'run_id',j.metadata->>'run_id',
              'source_url',j.metadata->>'source_url',
              'index_request_id',j.metadata->>'index_request_id',
              'retry_count',v_retry+1,
              'retry_of_request_id',j.request_id
            )
          );
          update public.structured_retail_http_jobs
            set status='failed',processed_at=v_now,error_message=v_msg,
                metadata=metadata||jsonb_build_object('retry_scheduled',true,'retry_request_id',v_req)
            where request_id=j.request_id;
        else
          update public.structured_retail_http_jobs
            set status='failed',processed_at=v_now,error_message=v_msg,
                metadata=metadata||jsonb_build_object('retry_exhausted',true)
            where request_id=j.request_id;
        end if;
      end if;
      continue;
    end if;

    if coalesce(r.status_code,0)<>200
       or r.timed_out
       or r.error_msg is not null
       or length(coalesce(r.content,''))<8000
       or lower(coalesce(r.content,'')) like '%just a moment%'
       or lower(coalesce(r.content,'')) like '%access denied%'
       or lower(coalesce(r.content,'')) like '%human verification%'
       or lower(coalesce(r.content,'')) like '%captcha%'
       or coalesce(r.content,'') not like '%produktů%' then
      v_msg := format('Möbelix SALE kategorie: neplatná odpověď HTTP %s / length %s.',coalesce(r.status_code,0),length(coalesce(r.content,'')));
      if v_retry<2 and coalesce(j.metadata->>'source_url','') like 'https://www.moebelix.cz/%' then
        v_req := net.http_get(
          url := 'https://r.jina.ai/'||(j.metadata->>'source_url'),
          headers := jsonb_build_object('User-Agent','Slevao/1.0','Accept','text/plain,text/markdown','X-With-Links-Summary','true'),
          timeout_milliseconds := 30000
        );
        insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
        values(
          v_req,j.store_id,'moebelix-sale-category-v1','pending',
          jsonb_build_object(
            'run_id',j.metadata->>'run_id',
            'source_url',j.metadata->>'source_url',
            'index_request_id',j.metadata->>'index_request_id',
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
      else
        update public.structured_retail_http_jobs
          set status='failed',processed_at=v_now,error_message=v_msg,
              metadata=metadata||jsonb_build_object(
                'retry_exhausted',true,
                'http_status',coalesce(r.status_code,0),
                'html_length',length(coalesce(r.content,''))
              )
          where request_id=j.request_id;
      end if;
      continue;
    end if;

    select count(*) into v_parsed
    from public.parse_moebelix_sale_category_markdown(r.content);

    update public.structured_retail_http_jobs
      set status='completed',processed_at=v_now,error_message=null,
          metadata=metadata||jsonb_build_object(
            'http_status',coalesce(r.status_code,200),
            'html_length',length(coalesce(r.content,'')),
            'strict_rows',coalesce(v_parsed,0)
          )
      where request_id=j.request_id;

    v_done:=v_done+1;
  end loop;

  -- Stage 3: publish only once the latest attempt for every category is terminal and complete.
  for runrec in
    select i.request_id as index_request_id,
           i.store_id,
           i.metadata->>'run_id' as run_id,
           coalesce((i.metadata->>'expected_categories')::int,0) as expected_categories,
           coalesce(a.category_jobs,0) as category_jobs,
           coalesce(a.pending_categories,0) as pending_categories,
           coalesce(a.failed_categories,0) as failed_categories,
           coalesce(a.completed_categories,0) as completed_categories
    from public.structured_retail_http_jobs i
    left join lateral (
      select count(*)::int as category_jobs,
             count(*) filter(where x.status='pending')::int as pending_categories,
             count(*) filter(where x.status='failed')::int as failed_categories,
             count(*) filter(where x.status='completed')::int as completed_categories
      from (
        select distinct on (c.metadata->>'source_url')
               c.request_id,c.status,c.metadata
        from public.structured_retail_http_jobs c
        where c.adapter='moebelix-sale-category-v1'
          and c.metadata->>'run_id'=i.metadata->>'run_id'
        order by c.metadata->>'source_url',
                 coalesce((c.metadata->>'retry_count')::int,0) desc,
                 c.request_id desc
      ) x
    ) a on true
    where i.adapter='moebelix-sale-index-v1'
      and i.status='completed'
      and coalesce((i.metadata->>'published')::boolean,false)=false
    order by i.request_id
    limit 5
  loop
    if runrec.pending_categories>0 then
      continue;
    end if;

    if runrec.failed_categories>0
       or runrec.category_jobs<>runrec.expected_categories
       or runrec.completed_categories<>runrec.expected_categories then
      v_msg := format(
        'Möbelix SALE run neúplný: očekáváno %s kategorií, completed %s, failed %s.',
        runrec.expected_categories,runrec.completed_categories,runrec.failed_categories
      );
      update public.structured_retail_http_jobs
        set status='failed',processed_at=v_now,error_message=v_msg,
            metadata=metadata||jsonb_build_object('published',false,'final_result','incomplete_categories')
        where request_id=runrec.index_request_id;
      update public.store_product_sync_state
        set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,
            health_status='error',health_reason=v_msg,updated_at=v_now
        where store_id=runrec.store_id;
      update public.leaflet_sources
        set last_checked_at=v_now,last_error=v_msg,updated_at=v_now
        where store_id=runrec.store_id and is_active=true;
      v_failed:=v_failed+1;
      continue;
    end if;

    with latest_jobs as (
      select distinct on (c.metadata->>'source_url')
             c.request_id,c.status,c.metadata
      from public.structured_retail_http_jobs c
      where c.adapter='moebelix-sale-category-v1'
        and c.metadata->>'run_id'=runrec.run_id
      order by c.metadata->>'source_url',
               coalesce((c.metadata->>'retry_count')::int,0) desc,
               c.request_id desc
    ), raw as (
      select p.*
      from latest_jobs c
      join net._http_response rr on rr.id=c.request_id
      cross join lateral public.parse_moebelix_sale_category_markdown(rr.content) p
      where c.status='completed'
    ), grouped as (
      select external_id,
             min(title) as title,
             min(normalized_title) as normalized_title,
             min(price) as price,
             min(old_price) as old_price,
             min(discount_percent) as discount_percent,
             min(source_url) as source_url,
             min(image_url) as image_url,
             min(moebelix_product_id) as moebelix_product_id,
             count(distinct price) as price_versions,
             count(distinct old_price) as old_price_versions,
             count(distinct discount_percent) as discount_versions,
             count(distinct source_url) as url_versions
      from raw
      group by external_id
    )
    select jsonb_agg(
             jsonb_build_object(
               'external_id',external_id,
               'title',title,
               'normalized_title',normalized_title,
               'quantity_text',null,
               'price',price,
               'old_price',old_price,
               'valid_from',v_today,
               'valid_to',v_today,
               'source_url',source_url,
               'source_page',1,
               'product_id',null,
               'image_url',image_url,
               'confidence',0.99,
               'metadata',jsonb_build_object(
                 'adapter','moebelix-jina-sale-categories-v1',
                 'parser_version','moebelix-jina-sale-categories-v1',
                 'moebelix_product_id',moebelix_product_id,
                 'discount_percent',discount_percent,
                 'coverage_scope','all_sale_categories_strict_identity',
                 'price_policy','consumer_price_including_vat',
                 'validity_policy','daily_verified_snapshot'
               )
             ) order by external_id
           ) filter(where price_versions=1 and old_price_versions=1 and discount_versions=1 and url_versions=1),
           count(*) filter(where price_versions=1 and old_price_versions=1 and discount_versions=1 and url_versions=1),
           count(*) filter(where price_versions<>1 or old_price_versions<>1 or discount_versions<>1 or url_versions<>1),
           md5(string_agg(
             external_id||'|'||price::text||'|'||old_price::text||'|'||discount_percent::text||'|'||source_url,
             E'\\n' order by external_id
           ) filter(where price_versions=1 and old_price_versions=1 and discount_versions=1 and url_versions=1))
    into v_rows,v_count,v_conflicts,v_signature
    from grouped;

    if coalesce(v_conflicts,0)>0 then
      v_msg := format('Möbelix SALE: %s produktových identit má konfliktní cenu nebo URL; publikace zastavena.',v_conflicts);
      update public.structured_retail_http_jobs
        set status='failed',processed_at=v_now,error_message=v_msg,
            metadata=metadata||jsonb_build_object('published',false,'final_result','identity_conflict')
        where request_id=runrec.index_request_id;
      update public.store_product_sync_state
        set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,
            health_status='error',health_reason=v_msg,last_product_candidates=coalesce(v_count,0),updated_at=v_now
        where store_id=runrec.store_id;
      v_failed:=v_failed+1;
      continue;
    end if;

    if coalesce(v_count,0)<60 or coalesce(v_count,0)>250 then
      v_msg := format('Möbelix parser vytvořil %s unikátních nabídek; bezpečný rozsah je 60–250.',coalesce(v_count,0));
      update public.structured_retail_http_jobs
        set status='failed',processed_at=v_now,error_message=v_msg,
            metadata=metadata||jsonb_build_object('published',false,'final_result','unsafe_offer_count','offer_count',coalesce(v_count,0))
        where request_id=runrec.index_request_id;
      update public.store_product_sync_state
        set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,
            health_status='error',health_reason=v_msg,last_product_candidates=coalesce(v_count,0),updated_at=v_now
        where store_id=runrec.store_id;
      v_failed:=v_failed+1;
      continue;
    end if;

    with latest_jobs as (
      select distinct on (c.metadata->>'source_url')
             c.request_id,c.status,c.metadata
      from public.structured_retail_http_jobs c
      where c.adapter='moebelix-sale-category-v1'
        and c.metadata->>'run_id'=runrec.run_id
      order by c.metadata->>'source_url',
               coalesce((c.metadata->>'retry_count')::int,0) desc,
               c.request_id desc
    )
    select coalesce(sum(length(coalesce(rr.content,''))),0)::int
    into v_total_html_length
    from latest_jobs c
    join net._http_response rr on rr.id=c.request_id
    where c.status='completed';

    begin
      v_result := public.publish_structured_store_offers(
        'moebelix',
        'moebelix-jina-sale-categories-v1',
        v_signature,
        v_rows,
        60,
        250,
        'https://www.moebelix.cz/c/slevy',
        'moebelix-jina-sale-categories-v1'
      );

      update public.structured_retail_http_jobs
        set metadata=metadata||jsonb_build_object(
              'published',true,
              'final_result','published',
              'offer_count',v_count,
              'result',v_result
            ),
            processed_at=v_now,
            error_message=null
        where request_id=runrec.index_request_id;

      update public.store_product_sync_state
        set is_running=false,
            run_started_at=null,
            last_error=null,
            last_parser_error=null,
            health_status='ok',
            health_reason=format('Automaticky publikováno %s ověřených SALE nabídek Möbelix z %s oficiálních kategorií.',v_count,runrec.expected_categories),
            last_http_status=200,
            last_html_length=v_total_html_length,
            last_product_candidates=v_count,
            last_published_count=v_count,
            last_valid_from=v_today,
            last_valid_to=v_today,
            coverage_scope='all_sale_categories_strict_identity',
            source_category='sale',
            minimum_offer_count=60,
            expected_offer_count=v_count,
            count_tolerance_percent=50,
            adapter_name='moebelix-jina-sale-categories-v1',
            adapter_version='moebelix-jina-sale-categories-v1',
            parser_version='moebelix-jina-sale-categories-v1',
            source_type='official-structured',
            updated_at=v_now
        where store_id=runrec.store_id;

      v_done:=v_done+1;
    exception when others then
      v_msg := 'Möbelix publikace selhala: '||sqlerrm;
      update public.structured_retail_http_jobs
        set status='failed',processed_at=v_now,error_message=v_msg,
            metadata=metadata||jsonb_build_object('published',false,'final_result','publish_error')
        where request_id=runrec.index_request_id;
      update public.store_product_sync_state
        set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,
            health_status='error',health_reason=v_msg,last_product_candidates=coalesce(v_count,0),updated_at=v_now
        where store_id=runrec.store_id;
      v_failed:=v_failed+1;
    end;
  end loop;

  return jsonb_build_object('ok',v_failed=0,'completed',v_done,'failed',v_failed);
end;
$function$;

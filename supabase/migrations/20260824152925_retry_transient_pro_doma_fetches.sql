create or replace function public.reconcile_pro_doma_index_sync()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'net', 'pg_temp'
as $function$
declare
  j record;
  r record;
  v_url text;
  v_req bigint;
  v_count int;
  v_done int := 0;
  v_failed int := 0;
  v_now timestamptz := now();
  v_msg text;
  v_retry_count int;
  v_transient boolean;
  v_fetch_url text;
begin
  for j in
    select *
    from public.structured_retail_http_jobs
    where adapter='pro-doma-index-v1'
      and status='pending'
      and coalesce(metadata->>'superseded_by','')=''
    order by requested_at
    limit 5
  loop
    v_retry_count := coalesce((j.metadata->>'retry_count')::int,0);
    v_fetch_url := coalesce(nullif(j.metadata->>'fetch_url',''),'https://assets.pro-doma.cz/akce');
    select * into r from net._http_response where id=j.request_id;

    if not found then
      if j.requested_at < v_now - interval '20 minutes' then
        v_msg := 'PRO-DOMA index timeout';
        if v_retry_count < 2 then
          v_req := net.http_get(
            url := 'https://r.jina.ai/' || v_fetch_url,
            headers := jsonb_build_object('User-Agent','Slevao/1.0','Accept','text/plain,text/markdown'),
            timeout_milliseconds := 30000
          );
          update public.structured_retail_http_jobs
          set status='failed',
              processed_at=v_now,
              error_message=v_msg,
              metadata=metadata||jsonb_build_object('superseded_by',v_req,'retry_scheduled',true,'retry_reason',v_msg)
          where request_id=j.request_id;
          insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
          values(
            v_req,j.store_id,'pro-doma-index-v1','pending',
            j.metadata || jsonb_build_object(
              'retry_count',v_retry_count+1,
              'parent_request_id',j.request_id,
              'retry_root_request_id',coalesce(j.metadata->>'retry_root_request_id',j.request_id::text),
              'retry_reason',v_msg
            ) - 'superseded_by' - 'retry_scheduled'
          );
          update public.store_product_sync_state
          set is_running=true,run_started_at=coalesce(run_started_at,v_now),last_error=null,last_parser_error=null,
              health_status='running',
              health_reason=format('PRO-DOMA: opakuji transientní index fetch (%s/2).',v_retry_count+1),
              updated_at=v_now
          where store_id=j.store_id;
          continue;
        end if;

        update public.structured_retail_http_jobs
        set status='failed',processed_at=v_now,error_message=v_msg
        where request_id=j.request_id;
        update public.store_product_sync_state
        set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,
            health_status='error',health_reason=v_msg,updated_at=v_now
        where store_id=j.store_id;
        v_failed := v_failed + 1;
      end if;
      continue;
    end if;

    v_transient := coalesce(r.timed_out,false)
      or r.error_msg is not null
      or coalesce(r.status_code,0) in (0,408,425,429)
      or coalesce(r.status_code,0) between 500 and 599
      or (coalesce(r.status_code,0)=200 and length(coalesce(r.content,''))<5000);

    if coalesce(r.status_code,0)<>200
       or coalesce(r.timed_out,false)
       or r.error_msg is not null
       or length(coalesce(r.content,''))<5000 then
      v_msg := format('PRO-DOMA index HTTP %s / length %s',coalesce(r.status_code,0),length(coalesce(r.content,'')));

      if v_transient and v_retry_count < 2 then
        v_req := net.http_get(
          url := 'https://r.jina.ai/' || v_fetch_url,
          headers := jsonb_build_object('User-Agent','Slevao/1.0','Accept','text/plain,text/markdown'),
          timeout_milliseconds := 30000
        );
        update public.structured_retail_http_jobs
        set status='failed',processed_at=v_now,error_message=v_msg,
            metadata=metadata||jsonb_build_object('superseded_by',v_req,'retry_scheduled',true,'retry_reason',v_msg)
        where request_id=j.request_id;
        insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
        values(
          v_req,j.store_id,'pro-doma-index-v1','pending',
          j.metadata || jsonb_build_object(
            'retry_count',v_retry_count+1,
            'parent_request_id',j.request_id,
            'retry_root_request_id',coalesce(j.metadata->>'retry_root_request_id',j.request_id::text),
            'retry_reason',v_msg
          ) - 'superseded_by' - 'retry_scheduled'
        );
        update public.store_product_sync_state
        set is_running=true,run_started_at=coalesce(run_started_at,v_now),last_error=null,last_parser_error=null,
            health_status='running',
            health_reason=format('PRO-DOMA: opakuji transientní index fetch (%s/2).',v_retry_count+1),
            updated_at=v_now
        where store_id=j.store_id;
        continue;
      end if;

      update public.structured_retail_http_jobs
      set status='failed',processed_at=v_now,error_message=v_msg
      where request_id=j.request_id;
      update public.store_product_sync_state
      set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,
          health_status='error',health_reason=v_msg,updated_at=v_now
      where store_id=j.store_id;
      v_failed := v_failed + 1;
      continue;
    end if;

    v_count := 0;
    for v_url in
      with b as (
        select ord, block
        from regexp_split_to_table(r.content,'event_main/') with ordinality x(block,ord)
        where ord>1
      ), candidates as (
        select distinct substring(block from 'https://(?:www|assets)[.]pro-doma[.]cz/[^ )]+') as event_url
        from b
      )
      select regexp_replace(event_url,'^https://assets[.]pro-doma[.]cz/','https://www.pro-doma.cz/')
      from candidates
      where event_url is not null
      limit 20
    loop
      v_req := net.http_get(
        url := 'https://r.jina.ai/' || v_url,
        headers := jsonb_build_object('User-Agent','Slevao/1.0','Accept','text/plain,text/markdown'),
        timeout_milliseconds := 30000
      );
      insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
      values(
        v_req,j.store_id,'pro-doma-detail-v1','pending',
        jsonb_build_object(
          'run_id',j.metadata->>'run_id',
          'event_url',v_url,
          'index_request_id',j.request_id,
          'retry_count',0,
          'retry_root_request_id',v_req
        )
      );
      v_count := v_count + 1;
    end loop;

    if v_count < 1 then
      v_msg := 'PRO-DOMA index neobsahuje eventy';
      update public.structured_retail_http_jobs
      set status='failed',processed_at=v_now,error_message=v_msg
      where request_id=j.request_id;
      update public.store_product_sync_state
      set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,
          health_status='error',health_reason=v_msg,updated_at=v_now
      where store_id=j.store_id;
      v_failed := v_failed + 1;
      continue;
    end if;

    update public.structured_retail_http_jobs
    set status='completed',processed_at=v_now,error_message=null,
        metadata=metadata||jsonb_build_object('expected_events',v_count,'published',false)
    where request_id=j.request_id;
    v_done := v_done + 1;
  end loop;

  return jsonb_build_object('ok',v_failed=0,'completed',v_done,'failed',v_failed);
end;
$function$;

create or replace function public.reconcile_pro_doma_detail_sync()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'net', 'pg_temp'
as $function$
declare
  idx record;
  d record;
  v_http record;
  v_pending int;
  v_failed int;
  v_expected int;
  v_rows jsonb;
  v_count int;
  v_sig text;
  v_result jsonb;
  v_now timestamptz:=now();
  v_today date:=(now() at time zone 'Europe/Prague')::date;
  v_done int:=0;
  v_bad int:=0;
  v_msg text;
  v_req bigint;
  v_retry_count int;
  v_transient boolean;
begin
  for idx in
    select *
    from public.structured_retail_http_jobs
    where adapter='pro-doma-index-v1'
      and status='completed'
      and coalesce(metadata->>'published','false')<>'true'
    order by requested_at
    limit 5
  loop
    v_expected:=coalesce((idx.metadata->>'expected_events')::int,0);
    if v_expected<1 then continue; end if;

    for d in
      select *
      from public.structured_retail_http_jobs
      where adapter='pro-doma-detail-v1'
        and metadata->>'run_id'=idx.metadata->>'run_id'
        and status='pending'
        and coalesce(metadata->>'superseded_by','')=''
      order by requested_at
    loop
      v_retry_count := coalesce((d.metadata->>'retry_count')::int,0);
      select * into v_http from net._http_response where id=d.request_id;

      if not found then
        if d.requested_at < v_now-interval '20 minutes' then
          v_msg := 'PRO-DOMA detail timeout';
          if v_retry_count < 2 then
            v_req := net.http_get(
              url := 'https://r.jina.ai/' || (d.metadata->>'event_url'),
              headers := jsonb_build_object('User-Agent','Slevao/1.0','Accept','text/plain,text/markdown'),
              timeout_milliseconds := 30000
            );
            update public.structured_retail_http_jobs
            set status='failed',processed_at=v_now,error_message=v_msg,
                metadata=metadata||jsonb_build_object('superseded_by',v_req,'retry_scheduled',true,'retry_reason',v_msg)
            where request_id=d.request_id;
            insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
            values(
              v_req,d.store_id,'pro-doma-detail-v1','pending',
              d.metadata || jsonb_build_object(
                'retry_count',v_retry_count+1,
                'parent_request_id',d.request_id,
                'retry_root_request_id',coalesce(d.metadata->>'retry_root_request_id',d.request_id::text),
                'retry_reason',v_msg
              ) - 'superseded_by' - 'retry_scheduled'
            );
            update public.store_product_sync_state
            set is_running=true,last_error=null,last_parser_error=null,health_status='running',
                health_reason=format('PRO-DOMA: opakuji transientní detail fetch (%s/2).',v_retry_count+1),updated_at=v_now
            where store_id=d.store_id;
          else
            update public.structured_retail_http_jobs
            set status='failed',processed_at=v_now,error_message=v_msg
            where request_id=d.request_id;
          end if;
        end if;
        continue;
      end if;

      v_transient := coalesce(v_http.timed_out,false)
        or v_http.error_msg is not null
        or coalesce(v_http.status_code,0) in (0,408,425,429)
        or coalesce(v_http.status_code,0) between 500 and 599
        or (coalesce(v_http.status_code,0)=200 and length(coalesce(v_http.content,''))<4000);

      if coalesce(v_http.status_code,0)<>200
         or coalesce(v_http.timed_out,false)
         or v_http.error_msg is not null
         or length(coalesce(v_http.content,''))<4000 then
        v_msg := format('PRO-DOMA detail HTTP %s / length %s',coalesce(v_http.status_code,0),length(coalesce(v_http.content,'')));
        if v_transient and v_retry_count < 2 then
          v_req := net.http_get(
            url := 'https://r.jina.ai/' || (d.metadata->>'event_url'),
            headers := jsonb_build_object('User-Agent','Slevao/1.0','Accept','text/plain,text/markdown'),
            timeout_milliseconds := 30000
          );
          update public.structured_retail_http_jobs
          set status='failed',processed_at=v_now,error_message=v_msg,
              metadata=metadata||jsonb_build_object('superseded_by',v_req,'retry_scheduled',true,'retry_reason',v_msg)
          where request_id=d.request_id;
          insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
          values(
            v_req,d.store_id,'pro-doma-detail-v1','pending',
            d.metadata || jsonb_build_object(
              'retry_count',v_retry_count+1,
              'parent_request_id',d.request_id,
              'retry_root_request_id',coalesce(d.metadata->>'retry_root_request_id',d.request_id::text),
              'retry_reason',v_msg
            ) - 'superseded_by' - 'retry_scheduled'
          );
          update public.store_product_sync_state
          set is_running=true,last_error=null,last_parser_error=null,health_status='running',
              health_reason=format('PRO-DOMA: opakuji transientní detail fetch (%s/2).',v_retry_count+1),updated_at=v_now
          where store_id=d.store_id;
        else
          update public.structured_retail_http_jobs
          set status='failed',processed_at=v_now,error_message=v_msg
          where request_id=d.request_id;
        end if;
      else
        update public.structured_retail_http_jobs
        set status='completed',processed_at=v_now,error_message=null
        where request_id=d.request_id;
      end if;
    end loop;

    select
      count(*) filter (where status='pending'),
      count(*) filter (where status='failed')
    into v_pending,v_failed
    from public.structured_retail_http_jobs
    where adapter='pro-doma-detail-v1'
      and metadata->>'run_id'=idx.metadata->>'run_id'
      and coalesce(metadata->>'superseded_by','')='';

    if v_pending>0 then continue; end if;

    if v_failed>0 then
      v_msg:=format('PRO-DOMA run neúplný po retry: %s detailů selhalo; předchozí nabídky zachovány.',v_failed);
      update public.structured_retail_http_jobs
      set status='failed',processed_at=v_now,error_message=v_msg,
          metadata=metadata||jsonb_build_object('published',false)
      where request_id=idx.request_id;
      update public.store_product_sync_state
      set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,
          health_status='error',health_reason=v_msg,updated_at=v_now
      where store_id=idx.store_id;
      v_bad:=v_bad+1;
      continue;
    end if;

    with details as (
      select j.request_id,j.metadata->>'event_url' event_url,resp.content
      from public.structured_retail_http_jobs j
      join net._http_response resp on resp.id=j.request_id
      where j.adapter='pro-doma-detail-v1'
        and j.metadata->>'run_id'=idx.metadata->>'run_id'
        and j.status='completed'
        and coalesce(j.metadata->>'superseded_by','')=''
    ), parsed as (
      select p.*
      from details d0
      cross join lateral public.parse_pro_doma_event_markdown(d0.content,d0.event_url) p
      where p.valid_from<=v_today and p.valid_to>=v_today
    ), dedup as (
      select distinct on(external_id) * from parsed order by external_id,valid_to desc
    )
    select
      jsonb_agg(jsonb_build_object(
        'external_id',external_id,'title',title,'normalized_title',normalized_title,
        'quantity_text',quantity_text,'price',price,'old_price',old_price,
        'valid_from',valid_from,'valid_to',valid_to,'source_url',source_url,
        'source_page',1,'product_id',null,'image_url',image_url,'confidence',0.99,'metadata',metadata
      ) order by external_id),
      count(*),
      md5(string_agg(external_id||'|'||price::text||'|'||coalesce(old_price::text,'')||'|'||valid_from::text||'|'||valid_to::text,E'\n' order by external_id))
    into v_rows,v_count,v_sig
    from dedup;

    if coalesce(v_count,0)<5 then
      update public.store_product_sync_state
      set is_running=false,run_started_at=null,last_error=null,last_parser_error=null,
          health_status='waiting_source',
          health_reason=format('PRO-DOMA: aktuální eventy obsahují jen %s bezpečných produktových cen.',coalesce(v_count,0)),
          last_product_candidates=coalesce(v_count,0),updated_at=v_now
      where store_id=idx.store_id;
      update public.structured_retail_http_jobs
      set metadata=metadata||jsonb_build_object('published',true,'result','waiting_source'),processed_at=v_now
      where request_id=idx.request_id;
      v_done:=v_done+1;
      continue;
    end if;

    begin
      v_result:=public.publish_structured_store_offers(
        'pro-doma','pro-doma-jina-events-v1',v_sig,v_rows,5,300,
        'https://www.pro-doma.cz/akce','pro-doma-jina-events-v1'
      );
      update public.structured_retail_http_jobs
      set metadata=metadata||jsonb_build_object('result',v_result)
      where adapter='pro-doma-detail-v1'
        and metadata->>'run_id'=idx.metadata->>'run_id'
        and status='completed'
        and coalesce(metadata->>'superseded_by','')='';
      update public.structured_retail_http_jobs
      set metadata=metadata||jsonb_build_object('published',true,'result',v_result),processed_at=v_now
      where request_id=idx.request_id;
      v_done:=v_done+1;
    exception when others then
      v_msg:=sqlerrm;
      update public.structured_retail_http_jobs
      set status='failed',processed_at=v_now,error_message=v_msg
      where request_id=idx.request_id;
      update public.store_product_sync_state
      set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,
          health_status='error',health_reason=v_msg,updated_at=v_now
      where store_id=idx.store_id;
      v_bad:=v_bad+1;
    end;
  end loop;

  return jsonb_build_object('ok',v_bad=0,'completed',v_done,'failed',v_bad);
end;
$function$;

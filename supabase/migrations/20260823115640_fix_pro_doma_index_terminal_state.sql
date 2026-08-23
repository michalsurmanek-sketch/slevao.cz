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
begin
  for j in
    select *
    from public.structured_retail_http_jobs
    where adapter='pro-doma-index-v1' and status='pending'
    order by requested_at
    limit 5
  loop
    select * into r from net._http_response where id=j.request_id;

    if not found then
      if j.requested_at < v_now - interval '20 minutes' then
        v_msg := 'PRO-DOMA index timeout';
        update public.structured_retail_http_jobs
          set status='failed', processed_at=v_now, error_message=v_msg
          where request_id=j.request_id;
        update public.store_product_sync_state
          set is_running=false,
              run_started_at=null,
              last_error=v_msg,
              last_parser_error=v_msg,
              health_status='error',
              health_reason=v_msg,
              updated_at=v_now
          where store_id=j.store_id;
        v_failed := v_failed + 1;
      end if;
      continue;
    end if;

    if coalesce(r.status_code,0)<>200
       or r.timed_out
       or r.error_msg is not null
       or length(coalesce(r.content,''))<5000 then
      v_msg := format(
        'PRO-DOMA index HTTP %s / length %s',
        coalesce(r.status_code,0),
        length(coalesce(r.content,''))
      );
      update public.structured_retail_http_jobs
        set status='failed', processed_at=v_now, error_message=v_msg
        where request_id=j.request_id;
      update public.store_product_sync_state
        set is_running=false,
            run_started_at=null,
            last_error=v_msg,
            last_parser_error=v_msg,
            health_status='error',
            health_reason=v_msg,
            updated_at=v_now
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
      )
      select distinct substring(block from 'https://www[.]pro-doma[.]cz/[^ )]+')
      from b
      where substring(block from 'https://www[.]pro-doma[.]cz/[^ )]+') is not null
      limit 20
    loop
      v_req := net.http_get(
        url := 'https://r.jina.ai/' || v_url,
        headers := jsonb_build_object(
          'User-Agent','Slevao/1.0',
          'Accept','text/plain,text/markdown'
        ),
        timeout_milliseconds := 30000
      );
      insert into public.structured_retail_http_jobs(
        request_id,store_id,adapter,status,metadata
      ) values (
        v_req,
        j.store_id,
        'pro-doma-detail-v1',
        'pending',
        jsonb_build_object(
          'run_id',j.metadata->>'run_id',
          'event_url',v_url,
          'index_request_id',j.request_id
        )
      );
      v_count := v_count + 1;
    end loop;

    if v_count < 1 then
      v_msg := 'PRO-DOMA index neobsahuje eventy';
      update public.structured_retail_http_jobs
        set status='failed', processed_at=v_now, error_message=v_msg
        where request_id=j.request_id;
      update public.store_product_sync_state
        set is_running=false,
            run_started_at=null,
            last_error=v_msg,
            last_parser_error=v_msg,
            health_status='error',
            health_reason=v_msg,
            updated_at=v_now
        where store_id=j.store_id;
      v_failed := v_failed + 1;
      continue;
    end if;

    update public.structured_retail_http_jobs
      set status='completed',
          processed_at=v_now,
          error_message=null,
          metadata=metadata||jsonb_build_object(
            'expected_events',v_count,
            'published',false
          )
      where request_id=j.request_id;
    v_done := v_done + 1;
  end loop;

  return jsonb_build_object(
    'ok',v_failed=0,
    'completed',v_done,
    'failed',v_failed
  );
end;
$function$;

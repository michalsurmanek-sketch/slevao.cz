-- Preserve the page count that Jina exposes in its PDF markdown header.
-- This intentionally does NOT infer per-product source_page because Jina markdown
-- does not expose reliable individual page boundaries for the current Lidl PDF.

create or replace function public.extract_lidl_jina_page_count(p_markdown text)
returns integer
language sql
immutable
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  with matched as (
    select regexp_match(coalesce(p_markdown,''), '(?im)^Number of Pages:\s*([0-9]{1,3})\s*$') as m
  ), parsed as (
    select case when m is not null then (m[1])::integer end as page_count
    from matched
  )
  select case when page_count between 1 and 200 then page_count else null end
  from parsed;
$function$;

revoke all on function public.extract_lidl_jina_page_count(text) from public, anon, authenticated;
grant execute on function public.extract_lidl_jina_page_count(text) to service_role;

create or replace function public.reconcile_lidl_verified_sync()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp', 'net'
as $function$
declare
  v_job record;
  v_response record;
  v_result jsonb;
  v_done integer:=0;
  v_failed integer:=0;
  v_message text;
  v_now timestamptz:=now();
  v_page_count integer;
  v_import_id uuid;
begin
  for v_job in
    select j.*
    from public.structured_retail_http_jobs j
    join public.stores s on s.id=j.store_id
    where s.slug='lidl'
      and j.adapter='lidl-verified-pdf-text-v1'
      and j.status='pending'
    order by j.requested_at
    limit 10
  loop
    select * into v_response from net._http_response where id=v_job.request_id;
    if not found then
      if v_job.requested_at<v_now-interval '20 minutes' then
        update public.structured_retail_http_jobs
          set status='failed',processed_at=v_now,error_message='HTTP response timeout'
        where request_id=v_job.request_id;
        v_failed:=v_failed+1;
      end if;
      continue;
    end if;

    if coalesce(v_response.status_code,0)<>200
       or v_response.timed_out
       or v_response.error_msg is not null
       or length(coalesce(v_response.content,''))<5000 then
      v_message:=format(
        'Lidl text HTTP %s / length %s: %s',
        coalesce(v_response.status_code,0),
        length(coalesce(v_response.content,'')),
        coalesce(v_response.error_msg,'invalid response')
      );
      update public.structured_retail_http_jobs
        set status='failed',processed_at=v_now,error_message=v_message
      where request_id=v_job.request_id;
      update public.store_product_sync_state
        set is_running=false,run_started_at=null,last_error=v_message,last_parser_error=v_message,
            health_status='error',health_reason=v_message,last_http_status=v_response.status_code,updated_at=v_now
      where store_id=v_job.store_id;
      v_failed:=v_failed+1;
      continue;
    end if;

    begin
      v_result:=public.publish_lidl_verified_markdown(
        v_response.content,
        (v_job.metadata->>'valid_from')::date,
        (v_job.metadata->>'valid_to')::date,
        v_job.request_id,
        v_job.metadata->>'pdf_url'
      );

      v_page_count:=public.extract_lidl_jina_page_count(v_response.content);
      v_import_id:=nullif(v_result->>'import_id','')::uuid;
      if v_import_id is not null and v_page_count is not null then
        update public.leaflet_imports
          set page_count=v_page_count,
              metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
                'page_count_source','jina_pdf_markdown_header',
                'page_identity_available',false,
                'page_count_verified_at',v_now
              ),
              updated_at=v_now
        where id=v_import_id;
      end if;

      update public.structured_retail_http_jobs
        set status='completed',processed_at=v_now,error_message=null,
            metadata=metadata||jsonb_build_object(
              'result',v_result,
              'jina_page_count',v_page_count,
              'page_identity_available',false
            )
      where request_id=v_job.request_id;
      v_done:=v_done+1;
    exception when others then
      v_message:=sqlerrm;
      update public.structured_retail_http_jobs
        set status='failed',processed_at=v_now,error_message=v_message
      where request_id=v_job.request_id;
      update public.store_product_sync_state
        set is_running=false,run_started_at=null,last_error=v_message,last_parser_error=v_message,
            health_status='error',health_reason=v_message,updated_at=v_now
      where store_id=v_job.store_id;
      update public.leaflet_sources
        set last_checked_at=v_now,last_error=v_message
      where store_id=v_job.store_id and is_active=true;
      v_failed:=v_failed+1;
    end;
  end loop;

  return jsonb_build_object('ok',v_failed=0,'completed',v_done,'failed',v_failed);
end;
$function$;

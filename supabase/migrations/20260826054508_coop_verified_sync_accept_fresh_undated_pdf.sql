create or replace function public.trigger_coop_verified_sync()
returns bigint
language plpgsql
security definer
set search_path to 'public','net','pg_temp'
as $function$
declare
  v_store_id uuid;
  v_pdf text;
  v_request_id bigint;
  v_now timestamptz := now();
  v_today date := (now() at time zone 'Europe/Prague')::date;
begin
  select id into v_store_id from public.stores where slug = 'coop';
  if v_store_id is null then
    raise exception 'COOP: obchod nebyl nalezen.';
  end if;

  select li.source_document_url into v_pdf
  from public.leaflet_imports li
  where li.store_id = v_store_id
    and li.source_document_url ilike 'https://www.coopclub.cz/%pdf'
    and (
      (li.detected_valid_from <= v_today and li.detected_valid_to >= v_today)
      or (
        li.detected_valid_from is null
        and li.detected_valid_to is null
        and li.created_at >= v_now - interval '72 hours'
      )
    )
  order by
    case
      when li.detected_valid_from <= v_today and li.detected_valid_to >= v_today then 0
      else 1
    end,
    (li.metadata->>'adapter' = 'coop-verified-pdf-text-v1') desc,
    li.created_at desc
  limit 1;

  if v_pdf is null then
    raise exception 'COOP: aktuální ani čerstvě objevené PDF nebylo nalezeno.';
  end if;

  if exists(
    select 1
    from public.structured_retail_http_jobs
    where store_id=v_store_id
      and adapter='coop-verified-pdf-text-v1'
      and status='pending'
      and coalesce(metadata->>'superseded_by','')=''
      and requested_at>v_now-interval '20 minutes'
  ) then
    return null;
  end if;

  v_request_id := net.http_get(
    url := 'https://r.jina.ai/' || v_pdf,
    headers := jsonb_build_object(
      'User-Agent','Slevao/1.0',
      'Accept','text/plain,text/markdown',
      'X-No-Cache','true',
      'Cache-Control','no-cache'
    ),
    timeout_milliseconds := 90000
  );

  insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
  values(
    v_request_id,
    v_store_id,
    'coop-verified-pdf-text-v1',
    'pending',
    jsonb_build_object(
      'pdf_url',v_pdf,
      'cache_bypass',true,
      'timeout_ms',90000,
      'retry_count',0,
      'retry_root_request_id',v_request_id,
      'fresh_undated_fallback',true
    )
  );

  update public.store_product_sync_state
  set last_run_at=v_now,
      is_running=true,
      run_started_at=v_now,
      last_error=null,
      last_parser_error=null,
      health_status='running',
      health_reason='COOP: načítám aktuální oficiální PDF text.',
      updated_at=v_now
  where store_id=v_store_id;

  return v_request_id;
end;
$function$;

create or replace function public.trigger_flop_top_verified_sync()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_store_id uuid;
  v_pdf text;
  v_request_id bigint;
  v_now timestamptz := now();
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_current_count integer;
begin
  select id into v_store_id from public.stores where slug = 'flop';

  select li.source_document_url into v_pdf
  from public.leaflet_imports li
  where li.store_id = v_store_id
    and li.detected_valid_from <= v_today
    and li.detected_valid_to >= v_today
    and li.source_document_url ~ '/[0-9]+_[0-9]+_(tisk_nahled_s|online)\.pdf$'
    and li.source_document_url !~* '/Flop_A_'
  order by li.confidence desc nulls last, li.created_at desc
  limit 1;

  if v_pdf is null then
    raise exception 'FLOP TOP: aktuální oficiální PDF nebylo nalezeno.';
  end if;

  select count(*) into v_current_count
  from public.offers
  where store_id = v_store_id
    and status = 'published'
    and valid_from <= v_today
    and valid_to >= v_today
    and source_url = v_pdf
    and coalesce(metadata ->> 'adapter', '') = 'flop-top-jina-pdf-v1';

  if v_current_count >= 50 then
    update public.store_product_sync_state
    set is_running = false,
        run_started_at = null,
        last_error = null,
        last_parser_error = null,
        last_offer_count = v_current_count,
        health_status = 'degraded',
        health_reason = format(
          'Publikováno %s ověřených FLOP TOP cen; běžný FLOP leták zůstává document-only.',
          v_current_count
        ),
        updated_at = v_now
    where store_id = v_store_id;
    return null;
  end if;

  if exists (
    select 1 from public.structured_retail_http_jobs
    where store_id = v_store_id
      and adapter = 'flop-top-jina-pdf-v1'
      and status = 'pending'
      and requested_at > v_now - interval '20 minutes'
  ) then
    return null;
  end if;

  v_request_id := net.http_get(
    url := 'https://r.jina.ai/' || v_pdf,
    headers := jsonb_build_object(
      'User-Agent', 'Slevao/1.0',
      'Accept', 'text/plain,text/markdown',
      'X-No-Cache', 'true',
      'Cache-Control', 'no-cache'
    ),
    timeout_milliseconds := 90000
  );

  insert into public.structured_retail_http_jobs(request_id, store_id, adapter, status, metadata)
  values (
    v_request_id,
    v_store_id,
    'flop-top-jina-pdf-v1',
    'pending',
    jsonb_build_object('pdf_url', v_pdf, 'format', 'FLOP TOP', 'cache_bypass', true)
  );

  update public.store_product_sync_state
  set last_run_at = v_now, is_running = true, run_started_at = v_now, updated_at = v_now
  where store_id = v_store_id;

  return v_request_id;
end;
$function$;

create or replace function public.mark_flop_transient_failure(
  p_store_id uuid,
  p_message text,
  p_http_status integer default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_current_count integer;
begin
  select count(*) into v_current_count
  from public.offers
  where store_id = p_store_id
    and status = 'published'
    and valid_from <= v_today
    and valid_to >= v_today;

  update public.store_product_sync_state
  set is_running = false,
      run_started_at = null,
      last_error = p_message,
      last_parser_error = p_message,
      last_http_status = coalesce(p_http_status, last_http_status),
      health_status = case when v_current_count > 0 then 'degraded' else 'error' end,
      health_reason = case
        when v_current_count > 0
          then format('Zdroj dočasně neodpověděl; zachováno %s platných ověřených nabídek.', v_current_count)
        else p_message
      end,
      updated_at = now()
  where store_id = p_store_id;
end;
$function$;

revoke all on function public.mark_flop_transient_failure(uuid,text,integer) from public;
grant execute on function public.mark_flop_transient_failure(uuid,text,integer) to service_role;

create or replace function public.reconcile_flop_top_verified_sync()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp', 'net'
as $function$
declare
  v_job record;
  v_response record;
  v_result jsonb;
  v_done integer := 0;
  v_failed integer := 0;
  v_message text;
  v_now timestamptz := now();
begin
  for v_job in
    select j.*
    from public.structured_retail_http_jobs j
    join public.stores s on s.id = j.store_id
    where s.slug = 'flop'
      and j.adapter = 'flop-top-jina-pdf-v1'
      and j.status = 'pending'
    order by j.requested_at
    limit 10
  loop
    select * into v_response from net._http_response where id = v_job.request_id;

    if not found then
      if v_job.requested_at < v_now - interval '20 minutes' then
        v_message := 'FLOP TOP text fetch timeout';
        update public.structured_retail_http_jobs
          set status = 'failed', processed_at = v_now, error_message = 'HTTP response timeout'
          where request_id = v_job.request_id;
        perform public.mark_flop_transient_failure(v_job.store_id, v_message, null);
        v_failed := v_failed + 1;
      end if;
      continue;
    end if;

    if coalesce(v_response.status_code, 0) <> 200
       or v_response.timed_out
       or v_response.error_msg is not null
       or length(coalesce(v_response.content, '')) < 5000 then
      v_message := format(
        'FLOP TOP text HTTP %s / length %s: %s',
        coalesce(v_response.status_code, 0),
        length(coalesce(v_response.content, '')),
        coalesce(v_response.error_msg, 'invalid response')
      );
      update public.structured_retail_http_jobs
        set status = 'failed', processed_at = v_now, error_message = v_message
        where request_id = v_job.request_id;
      perform public.mark_flop_transient_failure(v_job.store_id, v_message, v_response.status_code);
      v_failed := v_failed + 1;
      continue;
    end if;

    begin
      v_result := public.publish_flop_top_verified_markdown(
        v_response.content,
        v_job.request_id,
        v_job.metadata ->> 'pdf_url'
      );
      update public.structured_retail_http_jobs
        set status = 'completed',
            processed_at = v_now,
            error_message = null,
            metadata = metadata || jsonb_build_object('result', v_result)
        where request_id = v_job.request_id;
      v_done := v_done + 1;
    exception when others then
      v_message := sqlerrm;
      update public.structured_retail_http_jobs
        set status = 'failed', processed_at = v_now, error_message = v_message
        where request_id = v_job.request_id;
      perform public.mark_flop_transient_failure(v_job.store_id, v_message, v_response.status_code);
      update public.leaflet_sources
        set last_checked_at = v_now, last_error = v_message
        where store_id = v_job.store_id and is_active = true;
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object('ok', v_failed = 0, 'completed', v_done, 'failed', v_failed);
end;
$function$;
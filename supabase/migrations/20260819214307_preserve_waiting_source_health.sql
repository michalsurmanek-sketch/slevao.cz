create or replace function public.normalize_verified_partial_pipeline_health()
returns trigger
language plpgsql
set search_path = 'public', 'pg_temp'
as $function$
begin
  if new.health_status = 'waiting_source' then
    return new;
  end if;

  if new.parser_version in (
      'coop-verified-pdf-text-v1',
      'lidl-verified-pdf-text-v1',
      'flop-top-jina-pdf-v1'
    )
    and new.last_error is null
    and new.last_parser_error is null
    and coalesce(new.expected_offer_count,0) > 0
    and coalesce(new.last_published_count,0) >= new.expected_offer_count
  then
    new.health_status := 'ok';
    if new.health_reason is not null and new.health_reason not ilike 'Pipeline OK:%' then
      new.health_reason := 'Pipeline OK: ' || new.health_reason;
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.trigger_flop_top_verified_sync()
returns bigint
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
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
    update public.store_product_sync_state
    set is_running = false,
        run_started_at = null,
        last_run_at = v_now,
        last_error = null,
        last_parser_error = null,
        health_status = 'waiting_source',
        health_reason = 'FLOP TOP: čekám na aktuální oficiální PDF.',
        updated_at = v_now
    where store_id = v_store_id;

    update public.leaflet_sources
    set last_checked_at = v_now,
        last_error = null,
        updated_at = v_now
    where store_id = v_store_id
      and is_active is true;

    return null;
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

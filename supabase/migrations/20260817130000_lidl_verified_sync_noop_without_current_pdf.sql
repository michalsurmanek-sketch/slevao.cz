create or replace function public.trigger_lidl_verified_sync()
returns bigint
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_store_id uuid;
  v_pdf text;
  v_from date;
  v_to date;
  v_request_id bigint;
  v_now timestamptz := now();
  v_today date := (now() at time zone 'Europe/Prague')::date;
begin
  select id into v_store_id from public.stores where slug='lidl';
  if v_store_id is null then
    return null;
  end if;

  select li.source_document_url, li.detected_valid_from, li.detected_valid_to
    into v_pdf, v_from, v_to
  from public.leaflet_imports li
  where li.store_id=v_store_id
    and li.detected_valid_from<=v_today
    and li.detected_valid_to>=v_today
    and li.source_document_url ilike 'https://assets.leaflets.schwarz/%Akcni-letak-OD-%'
  order by li.created_at desc
  limit 1;

  if v_pdf is null then
    update public.store_product_sync_state
      set health_status='waiting_source',
          last_error='Lidl: aktuální hlavní PDF zatím není dostupné.',
          is_running=false,
          updated_at=v_now
    where store_id=v_store_id;
    return null;
  end if;

  if exists(
    select 1 from public.structured_retail_http_jobs
    where store_id=v_store_id
      and adapter='lidl-verified-pdf-text-v1'
      and status='pending'
      and requested_at>v_now-interval '20 minutes'
  ) then
    return null;
  end if;

  v_request_id:=net.http_get(
    url:='https://r.jina.ai/'||v_pdf,
    headers:=jsonb_build_object('User-Agent','Slevao/1.0','Accept','text/plain,text/markdown'),
    timeout_milliseconds:=30000
  );

  insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
  values(v_request_id,v_store_id,'lidl-verified-pdf-text-v1','pending',jsonb_build_object('pdf_url',v_pdf,'valid_from',v_from,'valid_to',v_to));

  update public.store_product_sync_state
    set last_run_at=v_now,
        is_running=true,
        run_started_at=v_now,
        health_status='running',
        last_error=null,
        updated_at=v_now
  where store_id=v_store_id;

  return v_request_id;
end;
$function$;

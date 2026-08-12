-- FLOP occasionally receives an empty cached Reader snapshot for a newly
-- published PDF. Force a fresh read so the verified parser sees all pages.
create or replace function public.trigger_flop_top_verified_sync()
returns bigint
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_store_id uuid; v_pdf text; v_request_id bigint; v_now timestamptz:=now();
  v_today date:=(now() at time zone 'Europe/Prague')::date;
begin
  select id into v_store_id from public.stores where slug='flop';
  select li.source_document_url into v_pdf
  from public.leaflet_imports li
  where li.store_id=v_store_id
    and li.detected_valid_from<=v_today and li.detected_valid_to>=v_today
    and li.source_document_url ~ '/[0-9]+_[0-9]+_(tisk_nahled_s|online)\.pdf$'
    and li.source_document_url !~* '/Flop_A_'
  order by li.confidence desc nulls last,li.created_at desc limit 1;
  if v_pdf is null then raise exception 'FLOP TOP: aktuální oficiální PDF nebylo nalezeno.'; end if;
  if exists(
    select 1 from public.structured_retail_http_jobs
    where store_id=v_store_id and adapter='flop-top-jina-pdf-v1'
      and status='pending' and requested_at>v_now-interval '20 minutes'
  ) then return null; end if;
  v_request_id:=net.http_get(
    url:='https://r.jina.ai/'||v_pdf,
    headers:=jsonb_build_object(
      'User-Agent','Slevao/1.0',
      'Accept','text/plain,text/markdown',
      'X-No-Cache','true'
    ),
    timeout_milliseconds:=55000
  );
  insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
  values(v_request_id,v_store_id,'flop-top-jina-pdf-v1','pending',jsonb_build_object('pdf_url',v_pdf,'format','FLOP TOP','cache_bypass',true));
  update public.store_product_sync_state
  set last_run_at=v_now,is_running=true,run_started_at=v_now,updated_at=v_now
  where store_id=v_store_id;
  return v_request_id;
end;
$function$;

revoke all on function public.trigger_flop_top_verified_sync() from public,anon,authenticated;
grant execute on function public.trigger_flop_top_verified_sync() to service_role;

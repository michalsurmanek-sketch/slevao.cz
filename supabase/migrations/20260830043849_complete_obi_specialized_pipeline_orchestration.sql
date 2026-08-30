create or replace function private.preserve_obi_bonial_validity()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
begin
  if coalesce(old.metadata->>'adapter','')='obi-bonial-v1' then
    if new.detected_valid_from is null then new.detected_valid_from:=old.detected_valid_from; end if;
    if new.detected_valid_to is null then new.detected_valid_to:=old.detected_valid_to; end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_preserve_obi_bonial_validity on public.leaflet_imports;
create trigger trg_preserve_obi_bonial_validity
before update of detected_valid_from,detected_valid_to on public.leaflet_imports
for each row execute function private.preserve_obi_bonial_validity();

create or replace function private.trigger_obi_missing_extractions()
returns integer
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $function$
declare
  v_row record;
  v_request_id bigint;
  v_count integer:=0;
  v_now timestamptz:=now();
  v_today date:=(now() at time zone 'Europe/Prague')::date;
begin
  for v_row in
    select li.id
    from public.leaflet_imports li
    join public.stores s on s.id=li.store_id
    where s.slug='obi'
      and li.metadata->>'adapter'='obi-bonial-v1'
      and li.status in ('published','review')
      and li.detected_valid_to>=v_today
      and li.source_document_url ~ '^https://aws-ops-bonial-biz-production-published-content-pdf[.]s3-eu-west-1[.]amazonaws[.]com/[0-9a-f-]{36}/[0-9a-f-]{36}[.]pdf$'
      and not exists(select 1 from public.leaflet_extracted_text et where et.import_id=li.id and et.parser='pdf-text-v3')
      and (
        nullif(li.metadata->>'text_extraction_requested_at','') is null
        or (li.metadata->>'text_extraction_requested_at')::timestamptz < v_now-interval '2 hours'
      )
    order by li.detected_valid_from desc nulls last,li.created_at desc
    limit 2
  loop
    v_request_id:=private.invoke_edge_function('process-leaflet-basic',jsonb_build_object('import_id',v_row.id),120000);
    update public.leaflet_imports
       set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
         'text_extraction_requested_at',v_now,
         'text_extraction_request_id',v_request_id,
         'text_extraction_orchestrator','obi-specialized-v1'
       ),
       updated_at=v_now
     where id=v_row.id;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$function$;

create or replace function private.trigger_obi_product_sync_if_ready()
returns bigint
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $function$
declare
  v_import_id uuid;
  v_request_id bigint;
  v_now timestamptz:=now();
  v_today date:=(now() at time zone 'Europe/Prague')::date;
begin
  select li.id
    into v_import_id
  from public.leaflet_imports li
  join public.stores s on s.id=li.store_id
  join public.leaflet_extracted_text et on et.import_id=li.id and et.parser='pdf-text-v3'
  where s.slug='obi'
    and li.metadata->>'adapter'='obi-bonial-v1'
    and li.detected_valid_from<=v_today
    and li.detected_valid_to>=v_today
    and coalesce((nullif(li.metadata->>'structured_product_synced_at',''))::timestamptz,'epoch'::timestamptz) < et.updated_at
    and (
      nullif(li.metadata->>'structured_product_sync_requested_at','') is null
      or (li.metadata->>'structured_product_sync_requested_at')::timestamptz < v_now-interval '2 hours'
    )
  order by li.detected_valid_from desc,li.created_at desc
  limit 1;

  if v_import_id is null then return null; end if;
  v_request_id:=private.invoke_edge_function('sync-obi-products','{}'::jsonb,120000);
  update public.leaflet_imports
     set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
       'structured_product_sync_requested_at',v_now,
       'structured_product_sync_request_id',v_request_id
     ),
     updated_at=v_now
   where id=v_import_id;
  return v_request_id;
end;
$function$;

create or replace function private.normalize_obi_structured_health()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_store_id uuid;
  v_count integer;
  v_from date;
  v_to date;
  v_now timestamptz:=now();
  v_today date:=(now() at time zone 'Europe/Prague')::date;
begin
  if new.status<>'published' or new.metadata->>'structured_product_adapter'<>'obi-spatial-official-v1' then return new; end if;
  select id into v_store_id from public.stores where slug='obi';
  if new.store_id<>v_store_id then return new; end if;
  select count(*)::integer,min(valid_from),max(valid_to)
    into v_count,v_from,v_to
  from public.offers
  where store_id=v_store_id and status='published' and valid_from<=v_today and valid_to>=v_today;
  insert into public.store_product_sync_state(
    store_id,last_run_at,last_success_at,last_offer_count,expected_offer_count,last_published_count,last_valid_from,last_valid_to,
    last_error,last_parser_error,health_status,health_reason,is_running,run_started_at,parser_version,adapter_name,adapter_version,
    source_type,source_category,coverage_scope,last_import_id,updated_at
  ) values(
    v_store_id,v_now,v_now,v_count,v_count,v_count,v_from,v_to,
    null,null,case when v_count>0 then 'ok' else 'degraded' end,
    case when v_count>0 then format('OBI: %s aktuálních ověřených nabídek z Bonial PDF + oficiálních produktových stránek.',v_count)
         else 'OBI: strukturovaný sync doběhl, ale nevytvořil aktuální nabídky.' end,
    false,null,'obi-pdf-spatial-v1','obi-spatial-official','v1','official-pdf-text+product-page','current-leaflet','national',new.id,v_now
  ) on conflict(store_id) do update set
    last_run_at=excluded.last_run_at,last_success_at=excluded.last_success_at,last_offer_count=excluded.last_offer_count,
    expected_offer_count=excluded.expected_offer_count,last_published_count=excluded.last_published_count,last_valid_from=excluded.last_valid_from,
    last_valid_to=excluded.last_valid_to,last_error=null,last_parser_error=null,health_status=excluded.health_status,
    health_reason=excluded.health_reason,is_running=false,run_started_at=null,parser_version=excluded.parser_version,
    adapter_name=excluded.adapter_name,adapter_version=excluded.adapter_version,source_type=excluded.source_type,
    source_category=excluded.source_category,coverage_scope=excluded.coverage_scope,last_import_id=excluded.last_import_id,updated_at=excluded.updated_at;
  return new;
end;
$function$;

drop trigger if exists trg_normalize_obi_structured_health on public.leaflet_imports;
create trigger trg_normalize_obi_structured_health
after update of status,product_count,metadata on public.leaflet_imports
for each row execute function private.normalize_obi_structured_health();

do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='sync-obi-official-source';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule('sync-obi-official-source','12 */6 * * *',$cron$select private.invoke_edge_function('sync-obi-source','{}'::jsonb,120000);$cron$);

  select jobid into v_job from cron.job where jobname='extract-obi-bonial-text';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule('extract-obi-bonial-text','17 */6 * * *',$cron$select private.trigger_obi_missing_extractions();$cron$);

  select jobid into v_job from cron.job where jobname='sync-obi-products-when-ready';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule('sync-obi-products-when-ready','27 */6 * * *',$cron$select private.trigger_obi_product_sync_if_ready();$cron$);
end $$;

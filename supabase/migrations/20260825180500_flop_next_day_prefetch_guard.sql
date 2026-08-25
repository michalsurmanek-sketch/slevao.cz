create or replace function public.trigger_flop_top_verified_sync()
returns bigint
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $$
declare
  v_store_id uuid;
  v_import_id uuid;
  v_pdf text;
  v_request_id bigint;
  v_now timestamptz := now();
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_target_date date := v_today;
  v_current_count integer;
  v_current_from date;
  v_current_to date;
  v_target_count integer;
  v_target_from date;
  v_target_to date;
  v_has_extraction boolean;
begin
  select id into v_store_id from public.stores where slug='flop';
  if v_store_id is null then
    raise exception 'FLOP obchod nebyl nalezen.';
  end if;

  select count(*),min(valid_from),max(valid_to)
    into v_current_count,v_current_from,v_current_to
  from public.offers
  where store_id=v_store_id
    and status='published'
    and is_verified=true
    and valid_from<=v_today
    and valid_to>=v_today
    and coalesce(store_location_name,'')='FLOP TOP';

  if v_current_count>=25 and coalesce(v_current_to,v_today)<=v_today then
    v_target_date:=v_today+1;
  end if;

  select count(*),min(valid_from),max(valid_to)
    into v_target_count,v_target_from,v_target_to
  from public.offers
  where store_id=v_store_id
    and status='published'
    and is_verified=true
    and valid_from<=v_target_date
    and valid_to>=v_target_date
    and coalesce(store_location_name,'')='FLOP TOP';

  if v_target_count>=25 then
    update public.store_product_sync_state
       set last_run_at=v_now,
           last_success_at=v_now,
           last_offer_count=v_target_count,
           last_error=null,
           last_parser_error=null,
           last_valid_from=v_target_from,
           last_valid_to=v_target_to,
           is_running=false,
           run_started_at=null,
           parser_version='flop-pdf-spatial-unit-price-v3',
           source_type='official-pdf-spatial',
           coverage_scope='store',
           source_category='current-offers',
           last_published_count=v_target_count,
           adapter_name='sync-flop-pdf-products',
           adapter_version='v3',
           health_status='degraded',
           health_reason=format('Publikováno %s matematicky ověřených FLOP TOP nabídek pro %s.',v_target_count,v_target_date),
           updated_at=v_now
     where store_id=v_store_id;
    return null;
  end if;

  with candidates as (
    select li.id,
           li.source_document_url,
           li.confidence,
           li.created_at,
           coalesce(
             li.detected_valid_from,
             (to_date(
               '20'||substring(li.source_document_url from '/[0-9]{1,2}_([0-9]{2})_(?:tisk_nahled_s|online)[.]pdf$')||
               lpad(substring(li.source_document_url from '/([0-9]{1,2})_[0-9]{2}_(?:tisk_nahled_s|online)[.]pdf$'),2,'0'),
               'IYYYIW'
             )+2)::date
           ) as effective_from,
           coalesce(
             li.detected_valid_to,
             (to_date(
               '20'||substring(li.source_document_url from '/[0-9]{1,2}_([0-9]{2})_(?:tisk_nahled_s|online)[.]pdf$')||
               lpad(substring(li.source_document_url from '/([0-9]{1,2})_[0-9]{2}_(?:tisk_nahled_s|online)[.]pdf$'),2,'0'),
               'IYYYIW'
             )+8)::date
           ) as effective_to
    from public.leaflet_imports li
    where li.store_id=v_store_id
      and li.source_document_url ~ '/[0-9]+_[0-9]+_(tisk_nahled_s|online)[.]pdf$'
      and li.source_document_url !~* '/Flop_A_'
      and li.status in ('queued','downloading','processing','review','published','ignored')
  )
  select id,source_document_url
    into v_import_id,v_pdf
  from candidates
  where effective_from<=v_target_date and effective_to>=v_target_date
  order by confidence desc nulls last,created_at desc
  limit 1;

  if v_import_id is null then
    update public.store_product_sync_state
       set is_running=false,
           run_started_at=null,
           last_run_at=v_now,
           last_error=null,
           last_parser_error=null,
           health_status='waiting_source',
           health_reason=format('FLOP TOP: čekám na oficiální PDF pro %s.',v_target_date),
           updated_at=v_now
     where store_id=v_store_id;
    return null;
  end if;

  if exists (
    select 1
    from public.structured_retail_http_jobs j
    where j.store_id=v_store_id
      and j.adapter in ('flop-pdf-basic-v3','flop-pdf-spatial-unit-price-v3')
      and j.status='pending'
      and j.requested_at>v_now-interval '20 minutes'
  ) then
    return null;
  end if;

  select exists(
    select 1 from public.leaflet_extracted_text e
    where e.import_id=v_import_id and e.parser='pdf-text-v3'
  ) into v_has_extraction;

  if v_has_extraction then
    v_request_id:=private.invoke_edge_function(
      'sync-flop-pdf-products',
      jsonb_build_object('import_id',v_import_id,'dry_run',false),
      120000
    );
    insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
    values(v_request_id,v_store_id,'flop-pdf-spatial-unit-price-v3','pending',
      jsonb_build_object('source_import_id',v_import_id,'pdf_url',v_pdf,'pipeline','internal-pdf-spatial-v3','target_date',v_target_date));
  else
    v_request_id:=private.invoke_edge_function(
      'process-leaflet-basic',
      jsonb_build_object('import_id',v_import_id),
      120000
    );
    insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
    values(v_request_id,v_store_id,'flop-pdf-basic-v3','pending',
      jsonb_build_object('source_import_id',v_import_id,'pdf_url',v_pdf,'pipeline','internal-pdf-spatial-v3','target_date',v_target_date));
  end if;

  update public.store_product_sync_state
     set last_run_at=v_now,
         is_running=true,
         run_started_at=v_now,
         last_error=null,
         last_parser_error=null,
         health_status='running',
         health_reason=format('FLOP TOP: zpracovávám oficiální PDF pro %s interní prostorovou pipeline.',v_target_date),
         updated_at=v_now
   where store_id=v_store_id;

  return v_request_id;
end;
$$;

create or replace function public.prevent_premature_flop_expiration()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
  v_flop_store_id uuid;
  v_today date := (now() at time zone 'Europe/Prague')::date;
begin
  if old.status='published'
     and new.status='expired'
     and old.valid_to is not null
     and old.valid_to>=v_today
     and coalesce(old.store_location_name,'')='FLOP TOP' then
    select id into v_flop_store_id from public.stores where slug='flop' limit 1;
    if old.store_id=v_flop_store_id then
      new.status:=old.status;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_premature_flop_expiration on public.offers;
create trigger trg_prevent_premature_flop_expiration
before update of status on public.offers
for each row
execute function public.prevent_premature_flop_expiration();

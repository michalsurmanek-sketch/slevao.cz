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
  v_current_count integer;
  v_current_from date;
  v_current_to date;
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

  if v_current_count>=25 then
    update public.store_product_sync_state
       set last_run_at=v_now,
           last_success_at=v_now,
           last_offer_count=v_current_count,
           last_error=null,
           last_parser_error=null,
           last_valid_from=v_current_from,
           last_valid_to=v_current_to,
           is_running=false,
           run_started_at=null,
           parser_version='flop-pdf-spatial-unit-price-v3',
           source_type='official-pdf-spatial',
           coverage_scope='store',
           source_category='current-offers',
           last_published_count=v_current_count,
           adapter_name='sync-flop-pdf-products',
           adapter_version='v3',
           health_status='degraded',
           health_reason=format('Publikováno %s matematicky ověřených FLOP TOP nabídek z oficiálního PDF.',v_current_count),
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
  where effective_from<=v_today and effective_to>=v_today
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
           health_reason='FLOP TOP: čekám na aktuální oficiální PDF.',
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
      jsonb_build_object('source_import_id',v_import_id,'pdf_url',v_pdf,'pipeline','internal-pdf-spatial-v3'));
  else
    v_request_id:=private.invoke_edge_function(
      'process-leaflet-basic',
      jsonb_build_object('import_id',v_import_id),
      120000
    );
    insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
    values(v_request_id,v_store_id,'flop-pdf-basic-v3','pending',
      jsonb_build_object('source_import_id',v_import_id,'pdf_url',v_pdf,'pipeline','internal-pdf-spatial-v3'));
  end if;

  update public.store_product_sync_state
     set last_run_at=v_now,
         is_running=true,
         run_started_at=v_now,
         last_error=null,
         last_parser_error=null,
         health_status='running',
         health_reason='FLOP TOP: zpracovávám aktuální oficiální PDF interní prostorovou pipeline.',
         updated_at=v_now
   where store_id=v_store_id;

  return v_request_id;
end;
$$;

create or replace function public.reconcile_flop_top_verified_sync()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp','net'
as $$
declare
  v_job record;
  v_response record;
  v_request_id bigint;
  v_source_import_id uuid;
  v_store_id uuid;
  v_derived_import_id uuid;
  v_candidate_count integer;
  v_offer_count integer;
  v_valid_from date;
  v_valid_to date;
  v_done integer:=0;
  v_failed integer:=0;
  v_message text;
  v_now timestamptz:=now();
  v_today date:=(now() at time zone 'Europe/Prague')::date;
begin
  select id into v_store_id from public.stores where slug='flop';
  if v_store_id is null then
    raise exception 'FLOP obchod nebyl nalezen.';
  end if;

  for v_job in
    select j.*
    from public.structured_retail_http_jobs j
    where j.store_id=v_store_id
      and j.adapter in ('flop-pdf-basic-v3','flop-pdf-spatial-unit-price-v3')
      and j.status='pending'
    order by j.requested_at
    limit 10
  loop
    select * into v_response from net._http_response where id=v_job.request_id;

    if not found then
      if v_job.requested_at<v_now-interval '20 minutes' then
        v_message:=format('%s HTTP response timeout',v_job.adapter);
        update public.structured_retail_http_jobs
           set status='failed',processed_at=v_now,error_message=v_message
         where request_id=v_job.request_id;
        perform public.mark_flop_transient_failure(v_store_id,v_message,null);
        v_failed:=v_failed+1;
      end if;
      continue;
    end if;

    if coalesce(v_response.status_code,0)<>200
       or v_response.timed_out
       or v_response.error_msg is not null then
      v_message:=format('%s HTTP %s: %s',v_job.adapter,coalesce(v_response.status_code,0),coalesce(v_response.error_msg,'request failed'));
      update public.structured_retail_http_jobs
         set status='failed',processed_at=v_now,error_message=v_message
       where request_id=v_job.request_id;
      perform public.mark_flop_transient_failure(v_store_id,v_message,v_response.status_code);
      v_failed:=v_failed+1;
      continue;
    end if;

    v_source_import_id:=nullif(v_job.metadata->>'source_import_id','')::uuid;
    if v_source_import_id is null then
      v_message:='FLOP internal pipeline job nemá source_import_id.';
      update public.structured_retail_http_jobs
         set status='failed',processed_at=v_now,error_message=v_message
       where request_id=v_job.request_id;
      perform public.mark_flop_transient_failure(v_store_id,v_message,v_response.status_code);
      v_failed:=v_failed+1;
      continue;
    end if;

    if v_job.adapter='flop-pdf-basic-v3' then
      if not exists(
        select 1 from public.leaflet_extracted_text e
        where e.import_id=v_source_import_id and e.parser='pdf-text-v3'
      ) then
        v_message:='FLOP pdfjs extrakce skončila bez pdf-text-v3 výstupu.';
        update public.structured_retail_http_jobs
           set status='failed',processed_at=v_now,error_message=v_message
         where request_id=v_job.request_id;
        perform public.mark_flop_transient_failure(v_store_id,v_message,v_response.status_code);
        v_failed:=v_failed+1;
        continue;
      end if;

      update public.structured_retail_http_jobs
         set status='completed',processed_at=v_now,error_message=null
       where request_id=v_job.request_id;

      if not exists(
        select 1 from public.structured_retail_http_jobs j
        where j.store_id=v_store_id
          and j.adapter='flop-pdf-spatial-unit-price-v3'
          and j.status='pending'
          and j.requested_at>v_now-interval '20 minutes'
      ) then
        v_request_id:=private.invoke_edge_function(
          'sync-flop-pdf-products',
          jsonb_build_object('import_id',v_source_import_id,'dry_run',false),
          120000
        );
        insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
        values(v_request_id,v_store_id,'flop-pdf-spatial-unit-price-v3','pending',
          jsonb_build_object('source_import_id',v_source_import_id,'pdf_url',v_job.metadata->>'pdf_url','pipeline','internal-pdf-spatial-v3'));
      end if;
      v_done:=v_done+1;
      continue;
    end if;

    select li.id,li.product_count,li.detected_valid_from,li.detected_valid_to
      into v_derived_import_id,v_candidate_count,v_valid_from,v_valid_to
    from public.leaflet_imports li
    where li.store_id=v_store_id
      and li.status='published'
      and li.source_hash='flop-pdf-spatial-safe-v3-'||v_source_import_id::text
    limit 1;

    if v_derived_import_id is null or coalesce(v_candidate_count,0)<25 then
      v_message:='FLOP spatial parser HTTP uspěl, ale nevznikl bezpečný publikovaný derived import.';
      update public.structured_retail_http_jobs
         set status='failed',processed_at=v_now,error_message=v_message
       where request_id=v_job.request_id;
      perform public.mark_flop_transient_failure(v_store_id,v_message,v_response.status_code);
      v_failed:=v_failed+1;
      continue;
    end if;

    select count(*) into v_offer_count
    from public.offers
    where store_id=v_store_id
      and status='published'
      and is_verified=true
      and valid_from<=v_today
      and valid_to>=v_today
      and coalesce(store_location_name,'')='FLOP TOP';

    if v_offer_count<25 then
      v_message:=format('FLOP spatial import má %s kandidátů, ale veřejně je jen %s ověřených nabídek.',v_candidate_count,v_offer_count);
      update public.structured_retail_http_jobs
         set status='failed',processed_at=v_now,error_message=v_message
       where request_id=v_job.request_id;
      perform public.mark_flop_transient_failure(v_store_id,v_message,v_response.status_code);
      v_failed:=v_failed+1;
      continue;
    end if;

    update public.structured_retail_http_jobs
       set status='completed',processed_at=v_now,error_message=null,
           metadata=metadata||jsonb_build_object('derived_import_id',v_derived_import_id,'candidate_count',v_candidate_count,'public_offer_count',v_offer_count)
     where request_id=v_job.request_id;

    update public.store_product_sync_state
       set last_run_at=v_now,
           last_success_at=v_now,
           last_source_signature='flop-pdf-spatial-safe-v3-'||v_source_import_id::text,
           last_offer_count=v_offer_count,
           last_error=null,
           last_parser_error=null,
           last_valid_from=v_valid_from,
           last_valid_to=v_valid_to,
           is_running=false,
           run_started_at=null,
           parser_version='flop-pdf-spatial-unit-price-v3',
           source_type='official-pdf-spatial',
           expected_offer_count=v_candidate_count,
           coverage_scope='store',
           source_category='current-offers',
           last_http_status=v_response.status_code,
           last_product_candidates=v_candidate_count,
           last_published_count=v_offer_count,
           last_import_id=v_derived_import_id,
           adapter_name='sync-flop-pdf-products',
           adapter_version='v3',
           source_fingerprint='flop-pdf-spatial-safe-v3-'||v_source_import_id::text,
           health_status='degraded',
           health_reason=format('Publikováno %s matematicky ověřených FLOP TOP nabídek z %s bezpečných PDF kandidátů.',v_offer_count,v_candidate_count),
           product_set_hash='flop-pdf-spatial-safe-v3-'||v_source_import_id::text,
           updated_at=v_now
     where store_id=v_store_id;

    v_done:=v_done+1;
  end loop;

  return jsonb_build_object('ok',v_failed=0,'completed',v_done,'failed',v_failed);
end;
$$;

-- BILLA coordinate parser is versioned independently from the reconcile loop.
-- Accept any numeric billa-coordinate-vN parser once verified items are present,
-- instead of pinning the reconcile step to v1/v2 and accidentally re-parsing v3+ forever.

create or replace function public.reconcile_billa_verified_pipeline()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare
  v_store_id uuid;
  v_source public.leaflet_imports%rowtype;
  v_verified public.leaflet_imports%rowtype;
  v_hash text;
  v_request_id bigint;
  v_has_extraction boolean := false;
  v_approved integer := 0;
  v_parser text;
begin
  select id into v_store_id
  from public.stores
  where slug = 'billa'
  limit 1;

  if v_store_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_billa_store');
  end if;

  select li.* into v_source
  from public.leaflet_imports li
  where li.store_id = v_store_id
    and li.source_document_url ilike '%.pdf%'
    and coalesce(li.metadata->>'verified_pipeline', 'false') <> 'true'
    and coalesce(li.metadata->>'adapter', '') in ('store:billa', '')
  order by li.created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'missing_billa_pdf_source');
  end if;

  v_hash := 'billa-coordinate-v1-' || md5(v_source.source_document_url);

  select li.* into v_verified
  from public.leaflet_imports li
  where li.source_hash = v_hash
  limit 1;

  if not found then
    insert into public.leaflet_imports (
      source_id, store_id, source_document_url, source_hash, status,
      coverage_scope, region_code, city_name, store_location_name, metadata
    ) values (
      v_source.source_id, v_source.store_id, v_source.source_document_url, v_hash,
      'processing', coalesce(v_source.coverage_scope, 'national'), v_source.region_code,
      v_source.city_name, v_source.store_location_name,
      jsonb_build_object(
        'adapter', 'store:billa-coordinate-pdf',
        'verified_pipeline', true,
        'source_import_id', v_source.id,
        'pipeline_stage', 'extracting',
        'created_by', 'reconcile_billa_verified_pipeline'
      )
    ) returning * into v_verified;

    v_request_id := private.invoke_edge_function(
      'process-leaflet-basic', jsonb_build_object('import_id', v_verified.id), 120000
    );

    return jsonb_build_object(
      'ok', true, 'stage', 'extracting', 'import_id', v_verified.id, 'request_id', v_request_id
    );
  end if;

  select exists(
    select 1
    from public.leaflet_extracted_text t
    where t.import_id = v_verified.id
      and t.parser = 'pdf-text-v3'
      and t.page_count > 0
      and t.text_chars > 500
  ) into v_has_extraction;

  v_parser := coalesce(v_verified.metadata->>'parser', '');

  if v_verified.status = 'failed' then
    return jsonb_build_object(
      'ok', false, 'stage', 'failed', 'import_id', v_verified.id, 'error', v_verified.error_message
    );
  end if;

  if not v_has_extraction then
    if v_verified.status not in ('processing', 'queued')
       or v_verified.updated_at < now() - interval '15 minutes' then
      update public.leaflet_imports
      set status = 'processing',
          error_message = null,
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('pipeline_stage', 'extracting')
      where id = v_verified.id;

      v_request_id := private.invoke_edge_function(
        'process-leaflet-basic', jsonb_build_object('import_id', v_verified.id), 120000
      );

      return jsonb_build_object(
        'ok', true, 'stage', 'extracting_retry', 'import_id', v_verified.id, 'request_id', v_request_id
      );
    end if;

    return jsonb_build_object('ok', true, 'stage', 'waiting_for_extraction', 'import_id', v_verified.id);
  end if;

  if v_parser !~ '^billa-coordinate-v[0-9]+$' then
    update public.leaflet_imports
    set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('pipeline_stage', 'parsing')
    where id = v_verified.id;

    v_request_id := private.invoke_edge_function(
      'sync-billa-products',
      jsonb_build_object('import_id', v_verified.id, 'dry_run', false),
      120000
    );

    return jsonb_build_object(
      'ok', true, 'stage', 'parsing', 'import_id', v_verified.id, 'request_id', v_request_id
    );
  end if;

  select count(*) into v_approved
  from public.leaflet_import_items
  where import_id = v_verified.id
    and status = 'approved'
    and confidence >= 0.99;

  if v_verified.status = 'published' then
    update public.leaflet_sources
    set last_error = null,
        last_checked_at = now(),
        last_success_at = now()
    where store_id = v_store_id;

    return jsonb_build_object(
      'ok', true, 'stage', 'published', 'import_id', v_verified.id, 'published_count', v_verified.product_count
    );
  end if;

  if v_verified.status = 'review' and v_approved > 0 then
    update public.leaflet_imports
    set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('pipeline_stage', 'publishing')
    where id = v_verified.id;

    v_request_id := private.invoke_edge_function(
      'publish-imports', jsonb_build_object('import_id', v_verified.id), 120000
    );

    return jsonb_build_object(
      'ok', true, 'stage', 'publishing', 'import_id', v_verified.id,
      'approved', v_approved, 'request_id', v_request_id
    );
  end if;

  return jsonb_build_object(
    'ok', true, 'stage', 'waiting', 'import_id', v_verified.id,
    'status', v_verified.status, 'approved', v_approved
  );
end;
$function$;

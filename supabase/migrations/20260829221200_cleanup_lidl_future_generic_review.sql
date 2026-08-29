update public.leaflet_imports li
set status='ignored',
    error_message=null,
    metadata=coalesce(li.metadata,'{}'::jsonb)||jsonb_build_object(
      'cleanup_reason','superseded_by_lidl_verified_future_prefetch',
      'superseded_by_import_id','1fb13cd1-1feb-4cd7-9b2c-7f151356a190'
    ),
    finished_at=coalesce(li.finished_at,clock_timestamp()),
    updated_at=clock_timestamp()
where li.id='a08812fd-8775-46a2-8f72-ff7cffdffbd2'::uuid
  and li.status='review'
  and exists (
    select 1
    from public.leaflet_imports verified
    where verified.id='1fb13cd1-1feb-4cd7-9b2c-7f151356a190'::uuid
      and verified.status='published'
      and verified.store_id=li.store_id
      and verified.source_document_url=li.source_document_url
      and verified.detected_valid_from=li.detected_valid_from
      and verified.detected_valid_to=li.detected_valid_to
      and verified.metadata->>'adapter'='lidl-verified-pdf-text-v1'
      and verified.product_count>=8
  );

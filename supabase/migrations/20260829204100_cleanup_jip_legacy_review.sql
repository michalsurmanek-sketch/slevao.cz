update public.leaflet_imports
set status='ignored',
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'cleanup_reason','superseded_by_jip_v7_v8_v2_only_pipeline',
      'cleanup_at',now()
    ),
    updated_at=now()
where status='review'
  and metadata->>'adapter'='jip-ocr-pack-v4'
  and exists (
    select 1
    from public.leaflet_imports newer
    where newer.store_id=leaflet_imports.store_id
      and newer.status='published'
      and newer.metadata->>'adapter'='jip-ocr-main-price-v7'
      and newer.metadata->>'ocr_engine'='tesseract-cli-ces-jip-v2'
      and newer.detected_valid_from<=current_date
      and newer.detected_valid_to>=current_date
  );

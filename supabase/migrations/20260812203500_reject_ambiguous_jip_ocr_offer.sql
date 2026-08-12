-- Remove one ambiguous JIP OCR offer whose nearby price block contains both
-- a current integer price and an old decimal price. Keep only the two rows
-- whose title and unit price are unambiguous, and attach the official leaflet
-- viewer so every retained offer remains traceable to its source.

with jip_store as (
  select id from public.stores where slug = 'jip'
), rejected as (
  update public.offers
  set status = 'rejected',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'rejected_reason', 'ambiguous_spatial_ocr_price_block',
        'rejected_at', now(),
        'review_note', 'OCR block contained both 82 and 92,90; safe current price could not be determined.'
      ),
      updated_at = now()
  where store_id = (select id from jip_store)
    and status = 'published'
    and valid_from <= current_date
    and valid_to >= current_date
    and lower(unaccent(title)) like 'strintyzky kureci parky%'
    and coalesce(metadata->>'source_page', '6') = '6'
  returning product_id
), official_source as (
  select li.source_document_url
  from public.leaflet_imports li
  where li.store_id = (select id from jip_store)
    and li.metadata->>'adapter' = 'jip-flip-pdf-v1'
    and li.detected_valid_from <= current_date
    and li.detected_valid_to >= current_date
    and li.source_document_url is not null
  order by (li.metadata->>'ocr_complete' = 'true') desc, li.created_at desc
  limit 1
)
update public.offers
set source_url = coalesce(source_url, (select source_document_url from official_source)),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'source_trace_repaired_at', now(),
      'source_trace_kind', 'official_leaflet_viewer'
    ),
    updated_at = now()
where store_id = (select id from jip_store)
  and status = 'published'
  and valid_from <= current_date
  and valid_to >= current_date;

update public.leaflet_import_items lii
set status = 'ignored',
    raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
      'ignored_reason', 'ambiguous_spatial_ocr_price_block',
      'ignored_at', now()
    )
where lower(unaccent(lii.title)) like 'strintyzky kureci parky%'
  and exists (
    select 1
    from public.leaflet_imports li
    join public.stores s on s.id = li.store_id
    where li.id = lii.import_id and s.slug = 'jip'
  );

update public.store_product_sync_state sps
set last_offer_count = 2,
    last_published_count = 2,
    health_status = 'degraded',
    health_reason = 'Bezpečně ponechány 2 ověřitelné OCR nabídky JIP; 1 nejednoznačný cenový blok byl odmítnut.',
    updated_at = now()
where sps.store_id = (select id from public.stores where slug = 'jip');

update public.products p
set is_active = false,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'deactivated_reason', 'only_offer_rejected_ambiguous_jip_ocr',
      'deactivated_at', now()
    ),
    updated_at = now()
where lower(unaccent(p.name)) like 'strintyzky kureci parky%'
  and not exists (
    select 1 from public.offers o
    where o.product_id = p.id and o.status = 'published' and o.valid_to >= current_date
  );

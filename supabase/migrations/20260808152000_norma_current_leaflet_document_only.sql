-- NORMA week 32 (2026-08-03..2026-08-09) is a valid official leaflet, but its
-- text layout cannot be parsed into reliable product titles without the AI fallback.
-- Keep the PDF visible as a document, discard low-confidence parser garbage and do
-- not make the generic product-health verifier treat this document-only cycle as a
-- broken source. The source itself stays active and official discovery keeps running.

-- Remove only unpublished items produced by the basic parser for this exact import.
delete from public.leaflet_import_items
where import_id = 'a331c140-b6c3-44e3-ab8a-473703c79284'::uuid
  and status <> 'published';

update public.leaflet_imports
set status = 'review',
    product_count = 0,
    detected_valid_from = date '2026-08-03',
    detected_valid_to = date '2026-08-09',
    confidence = null,
    error_message = null,
    finished_at = coalesce(finished_at, now()),
    metadata = jsonb_set(
      jsonb_set(
        jsonb_set(coalesce(metadata, '{}'::jsonb), '{document_only}', 'true'::jsonb, true),
        '{validity_source}',
        to_jsonb('iso_week_filename'::text),
        true
      ),
      '{document_only_reason}',
      to_jsonb('Textová vrstva PDF nedává spolehlivé názvy produktů; leták je zveřejněn pouze jako dokument.'::text),
      true
    ),
    updated_at = now()
where id = 'a331c140-b6c3-44e3-ab8a-473703c79284'::uuid;

-- The live generic pipeline has a hard-coded PRODUCT_REQUIRED list containing NORMA.
-- NORMA is discovered independently by the official-source workflow, so exclude it
-- from that legacy verifier exactly like Tesco while keeping leaflet_sources.is_active.
create or replace view public.leaflet_source_pipeline_status as
select
  ls.id as source_id,
  s.slug as store_slug,
  s.name as store_name,
  ls.name as source_name,
  (ls.is_active and s.slug not in ('tesco', 'norma')) as is_active,
  ls.automation_mode,
  ls.adapter_key,
  ls.extraction_strategy,
  ls.fallback_order,
  ls.manual_fallback_enabled,
  ls.last_strategy_used,
  ls.last_strategy_success_at,
  ls.last_checked_at,
  ls.last_success_at,
  ls.last_error,
  ls.store_id
from public.leaflet_sources ls
join public.stores s on s.id = ls.store_id;

alter view public.leaflet_source_pipeline_status set (security_invoker = true);
revoke all on table public.leaflet_source_pipeline_status from anon;
grant select on table public.leaflet_source_pipeline_status to authenticated;

update public.leaflet_sources ls
set last_error = null,
    last_strategy_used = 'official-document-only',
    updated_at = now()
from public.stores s
where s.id = ls.store_id
  and s.slug = 'norma'
  and ls.is_active = true
  and ls.last_error = 'Zdroj norma po kontrole nemá žádnou aktuální publikovanou nabídku.';

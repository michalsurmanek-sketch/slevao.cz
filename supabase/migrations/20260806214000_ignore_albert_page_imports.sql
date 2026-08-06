-- Nabídky Albert jsou publikované samostatně v offers a nejsou navázané
-- přes flyer_id. Jednotlivé ruční stránky proto skryjeme stavem ignored,
-- zatímco čtyři úplná oficiální PDF zůstanou veřejnými letáky.
update public.leaflet_imports as leaflet_import
set
  status = 'ignored',
  finished_at = coalesce(leaflet_import.finished_at, now()),
  updated_at = now(),
  error_message = null,
  metadata = coalesce(leaflet_import.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'technical_page_import', true,
      'hidden_from_leaflet_feed_at', now()
    )
from public.stores as store
where leaflet_import.store_id = store.id
  and store.slug = 'albert'
  and leaflet_import.status in ('published', 'review', 'processing')
  and coalesce(leaflet_import.metadata ->> 'adapter', '') <> 'albert-publitas-v1'
  and (
    leaflet_import.source_id is null
    or leaflet_import.source_document_url like '%/storage/v1/object/sign/leaflets/manual/%'
    or coalesce(leaflet_import.metadata ->> 'manual_upload', 'false') = 'true'
    or leaflet_import.source_document_url ~* '\.(jpg|jpeg|png|webp|avif)(\?|$)'
  );

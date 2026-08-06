-- Ručně nahrané jednotlivé stránky Kaufland sloužily k vytěžení produktů,
-- ale nejsou samostatnými letáky. Produkty zůstávají publikované; pouze
-- dokumentové importy ukončíme, aby veřejný feed zobrazoval celé PDF.
update public.leaflet_imports as leaflet_import
set
  detected_valid_to = current_date - 1,
  updated_at = now(),
  metadata = coalesce(leaflet_import.metadata, '{}'::jsonb)
    || jsonb_build_object('hidden_from_leaflet_feed_at', now())
from public.stores as store
where leaflet_import.store_id = store.id
  and store.slug = 'kaufland'
  and leaflet_import.status in ('published', 'review', 'publishing')
  and coalesce(leaflet_import.metadata ->> 'adapter', '') <> 'kaufland-pdf-v1'
  and (
    leaflet_import.source_id is null
    or coalesce(leaflet_import.metadata ->> 'manual_upload', 'false') = 'true'
    or leaflet_import.source_document_url ~* '\.(?:jpe?g|png|webp|avif)(?:\?|$)'
  )
  and (leaflet_import.detected_valid_to is null or leaflet_import.detected_valid_to >= current_date);

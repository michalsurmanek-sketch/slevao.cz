-- Některé starší ruční importy nemají source_id ani jednotný adapter.
-- Poznáme je jednoznačně podle cesty podepsaného objektu v adresáři manual.
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
    or leaflet_import.source_document_url like '%/storage/v1/object/sign/leaflets/manual/%'
    or coalesce(leaflet_import.metadata ->> 'manual_upload', 'false') = 'true'
  )
  and (leaflet_import.detected_valid_to is null or leaflet_import.detected_valid_to >= current_date);

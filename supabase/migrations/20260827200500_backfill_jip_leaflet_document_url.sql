-- JIP OCR offers already carry an exact leaflet_page and a source URL pointing
-- to the current official Maloobchod viewer. Add the corresponding official PDF
-- document URL so the existing public card "Leták · strana X" link can render.
-- Do not touch offers without an exact positive page number.

update public.offers o
set metadata = coalesce(o.metadata, '{}'::jsonb) || jsonb_build_object(
  'leaflet_document_url', regexp_replace(split_part(o.source_url, '#', 1), '/?$', '/files/downloads/MO.pdf'),
  'leaflet_location_source', coalesce(nullif(o.metadata->>'leaflet_location_source',''), 'jip-official-pdf-backfill-v1')
)
from public.stores s
where s.id = o.store_id
  and s.slug = 'jip'
  and o.status = 'published'
  and o.is_verified is true
  and coalesce(o.metadata->>'leaflet_page','') ~ '^[1-9][0-9]{0,2}$'
  and coalesce(o.metadata->>'leaflet_document_url','') = ''
  and o.source_url ~ '^https://www\.jip-potraviny\.cz/wp-content/uploads/file/MO-[^#]+/#page=[1-9][0-9]{0,2}$';

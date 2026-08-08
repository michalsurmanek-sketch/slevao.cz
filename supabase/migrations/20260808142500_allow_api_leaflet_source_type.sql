-- Several production source adapters (for example dm) correctly classify their
-- machine-readable source as `api`, while the old constraint only allowed html/pdf/json.
-- The failed metadata update was ignored by some adapters and produced PostgreSQL errors
-- despite an HTTP 200 sync. Make the schema match the supported extraction strategies.

alter table public.leaflet_sources
  drop constraint if exists leaflet_sources_source_type_check;

alter table public.leaflet_sources
  add constraint leaflet_sources_source_type_check
  check (source_type = any (array['html'::text, 'pdf'::text, 'json'::text, 'api'::text]));

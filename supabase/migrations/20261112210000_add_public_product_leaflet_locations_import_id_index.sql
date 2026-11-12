-- Speed up import-scoped cleanup from sync_public_product_leaflet_import().
-- The existing primary key starts with product_id, so it cannot efficiently
-- support DELETE ... WHERE import_id = new.id.
create index if not exists public_product_leaflet_locations_import_idx
  on public.public_product_leaflet_locations using btree (import_id);

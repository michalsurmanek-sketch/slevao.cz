create index if not exists product_aliases_store_lookup_idx
  on public.product_aliases(source_store_id, normalized_alias)
  where source_store_id is not null;

create index if not exists leaflet_import_items_product_idx
  on public.leaflet_import_items(product_id)
  where product_id is not null;

create index if not exists product_image_library_candidate_idx
  on public.product_image_library(approved_candidate_id)
  where approved_candidate_id is not null;

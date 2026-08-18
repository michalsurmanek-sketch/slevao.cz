create index if not exists offer_visual_fallback_candidates_import_id_idx
  on private.offer_visual_fallback_candidates(import_id);

create index if not exists offer_visual_fallback_candidates_product_id_idx
  on private.offer_visual_fallback_candidates(product_id);

create index if not exists offer_visual_fallback_candidates_store_id_idx
  on private.offer_visual_fallback_candidates(store_id);

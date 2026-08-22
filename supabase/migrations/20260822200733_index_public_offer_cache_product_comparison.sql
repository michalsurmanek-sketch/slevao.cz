create index if not exists public_offer_search_cache_product_comparison_idx
  on private.public_offer_search_cache (product_id, price, valid_to, offer_id);

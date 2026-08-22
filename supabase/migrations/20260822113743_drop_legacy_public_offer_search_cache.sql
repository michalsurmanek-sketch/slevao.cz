-- The replacement public offer search cache was verified through public RPC,
-- anon access and REFRESH MATERIALIZED VIEW CONCURRENTLY before this cleanup.

drop materialized view if exists private.public_offer_search_cache_legacy;

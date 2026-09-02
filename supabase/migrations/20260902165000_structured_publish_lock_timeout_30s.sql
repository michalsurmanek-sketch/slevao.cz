-- Give structured retailer publishers enough time to survive short-lived lock contention.
-- API sessions use authenticator lock_timeout=8s, while these publishers can legitimately
-- run inside longer 180s transactions and overlap with scheduled maintenance jobs.
-- Scope this override to the structured publishing RPCs only; do not relax the whole API.

alter function public.publish_structured_store_offers(
  text, text, text, jsonb, integer, integer, text, text
) set lock_timeout = '30s';

alter function public.publish_structured_store_offers_with_source_category(
  text, text, text, jsonb, integer, integer, text, text
) set lock_timeout = '30s';

alter function private.publish_structured_store_offers_full(
  text, text, text, jsonb, integer, integer, text, text
) set lock_timeout = '30s';

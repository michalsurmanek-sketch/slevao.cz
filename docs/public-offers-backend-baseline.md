# Public Offers backend baseline — 2026-08-17

Stabilizační bod před přepojením homepage na serverový feed.

- `get_public_offer_page_filtered`: server-side query, store, filter_group, region/city, price, image-only, mode, sort, offset/limit.
- `get_public_offer_facets`: contextual store/category-group facets.
- `public_offer_search_cache`: materialized deduplicated public offer cache.
- Cache refresh: `refresh-public-offer-search-cache`, každých 5 minut.
- Baseline pool (+7 dní): 6 718 deduplikovaných nabídek.
- `recommended`: 1 465.
- Penny: 428.
- Search `mleko`: 35.
- Performance baseline: recommended page ~28 ms; `mleko` search ~137 ms; recommended facets ~44 ms (database execution measurements).
- Public taxonomy metadata coverage in current +7d source pool after conservative backfill: 68.4%; runtime public cache uses centralized DB fallback for remaining rows.

Homepage `assets/home-v2.js` is still client-side at this baseline and has not yet been switched to the new API.
update public.products
set classification_source = 'auto-kelly-segment-v1',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'classification_version', 'auto-kelly-segment-v1',
      'classification_reason', 'pure-automotive-retailer'
    )
where metadata->>'classification_reason' = 'pure-automotive-retailer'
  and category_id = (select id from public.categories where slug='auto' limit 1)
  and filter_group = 'auto';

refresh materialized view private.public_offer_search_cache;

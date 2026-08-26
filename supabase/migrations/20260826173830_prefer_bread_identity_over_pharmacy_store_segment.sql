set local statement_timeout = '60s';

update public.products p
set filter_group='food',
    filter_tags=array['pecivo']::text[],
    classification_confidence=greatest(coalesce(p.classification_confidence,0),0.99),
    classification_source='semantic-bread-over-store-segment-v1',
    classified_at=now(),
    updated_at=now()
where p.filter_group='pharmacy'
  and 'bread'=any(public.public_offer_semantic_tags(concat_ws(' ',p.name,p.brand)));

select private.refresh_public_offer_search_cache_if_dirty(true);
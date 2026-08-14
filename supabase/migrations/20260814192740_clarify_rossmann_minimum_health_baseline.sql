update public.store_product_sync_state s
set last_published_count=last_offer_count,
    adapter_name='rossmann-continuous-snapshot',
    adapter_version='v1',
    source_type='official-product-pages',
    source_category='current-offers',
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'expected_count_semantics','minimum_baseline',
      'overlap_reconciler','reconcile_dm_rossmann_overlapping_snapshots',
      'distinct_current_sets',2
    ),
    health_reason=format('Rossmann: %s aktuálních publikovaných nabídek; minimum baseline je %s. Překryvy stejného produktu průběžně odstraňuje reconcile_dm_rossmann_overlapping_snapshots.',last_offer_count,expected_offer_count),
    updated_at=now()
from public.stores st
where s.store_id=st.id and st.slug='rossmann';

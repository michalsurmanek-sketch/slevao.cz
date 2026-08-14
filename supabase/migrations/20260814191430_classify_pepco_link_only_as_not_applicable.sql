update public.store_product_sync_state s
set health_status='not_applicable',
    health_reason='Pepco je záměrně link-only: bezpečný produktový parser se nepoužívá a web odkazuje na oficiální aktuální nabídku; nulový počet interních produktů není chyba synchronizace.',
    source_type='official-link',
    source_category='link-only',
    expected_offer_count=0,
    last_offer_count=0,
    last_published_count=0,
    last_error=null,
    last_parser_error=null,
    updated_at=now()
from public.stores st
where s.store_id=st.id and st.slug='pepco';

update public.store_product_sync_state s
set health_status='blocked',
    health_reason='DATART: oficiální stránka /akcni-letak.html vrací do serverového runtime TSPD anti-bot challenge místo obsahu letáku; bezpečný serverový produktový zdroj není dostupný.',
    last_error='DATART TSPD anti-bot challenge',
    last_parser_error=null,
    updated_at=now()
from public.stores st
where s.store_id=st.id and st.slug='datart';

update public.leaflet_sources ls
set last_checked_at=now(),
    last_error='TSPD anti-bot challenge místo obsahu letáku',
    disabled_reason='Oficiální DATART stránka je pro serverové načítání chráněna TSPD anti-bot vrstvou.',
    automation_mode='paused',
    is_active=false,
    auto_publish=false,
    updated_at=now()
from public.stores st
where ls.store_id=st.id and st.slug='datart';

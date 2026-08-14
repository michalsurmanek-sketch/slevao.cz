insert into public.leaflet_sources (
  store_id,name,source_url,source_type,is_active,auto_publish,check_interval_minutes,
  automation_mode,disabled_reason,extraction_strategy,manual_fallback_enabled,
  last_checked_at,last_error,coverage_scope,updated_at
)
select st.id,'H&M – oficiální výprodej','https://www2.hm.com/cs_cz/men/sale/view-all.html','html',false,false,1440,
       'paused','Oficiální H&M CZ výprodej je veřejně dostupný v prohlížeči, ale serverové načítání ze Supabase runtime vrací HTTP 403 Access Denied (Akamai/EdgeSuite).',
       'auto',false,now(),'HTTP 403 Access Denied z Akamai/EdgeSuite','national',now()
from public.stores st
where st.slug='hm'
  and not exists (select 1 from public.leaflet_sources ls where ls.store_id=st.id and ls.source_url='https://www2.hm.com/cs_cz/men/sale/view-all.html');

update public.store_product_sync_state s
set health_status='blocked',
    health_reason='H&M CZ: veřejný výprodej obsahuje produkty a ceny, ale Supabase serverový runtime dostává HTTP 403 Access Denied z Akamai/EdgeSuite; bezpečný serverový feed/API není k dispozici.',
    last_error='HTTP 403 Access Denied z Akamai/EdgeSuite',
    last_parser_error=null,
    source_type='official-html-blocked',
    source_category='sale',
    adapter_name='hm-sale-source',
    adapter_version='blocked-v1',
    updated_at=now()
from public.stores st
where s.store_id=st.id and st.slug='hm';

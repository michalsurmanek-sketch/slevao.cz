with checked(slug,source_error,reason) as (
  values
    ('alza','HTTP 403 při serverovém načítání','Alza.cz: oficiální web dnes znovu vrací serverovému runtime HTTP 403; automatické produktové načítání zůstává externě blokované.'),
    ('moebelix','Cloudflare HTTP 403 challenge','Möbelix: oficiální web dnes znovu vrací Cloudflare HTTP 403 challenge; automatické produktové načítání zůstává externě blokované.'),
    ('mountfield','Cloudflare HTTP 403 challenge','Mountfield: oficiální web dnes znovu vrací Cloudflare HTTP 403 challenge; automatické produktové načítání zůstává externě blokované.'),
    ('enapo','SSL peer certificate or SSH remote key was not OK','Enapo: oficiální server dnes stále selhává na ověření TLS certifikátu; zdroj nelze bezpečně serverově načíst.')
)
update public.leaflet_sources ls
set last_checked_at=now(),last_error=c.source_error,updated_at=now()
from public.stores st, checked c
where ls.store_id=st.id and st.slug=c.slug;

with checked(slug,reason,err) as (
  values
    ('alza','Alza.cz: oficiální web dnes znovu vrací serverovému runtime HTTP 403; automatické produktové načítání zůstává externě blokované.','HTTP 403'),
    ('moebelix','Möbelix: oficiální web dnes znovu vrací Cloudflare HTTP 403 challenge; automatické produktové načítání zůstává externě blokované.','Cloudflare HTTP 403'),
    ('mountfield','Mountfield: oficiální web dnes znovu vrací Cloudflare HTTP 403 challenge; automatické produktové načítání zůstává externě blokované.','Cloudflare HTTP 403'),
    ('enapo','Enapo: oficiální server dnes stále selhává na ověření TLS certifikátu; zdroj nelze bezpečně serverově načíst.','TLS certificate validation failed')
)
update public.store_product_sync_state s
set health_status='blocked',health_reason=c.reason,last_error=c.err,last_parser_error=null,updated_at=now()
from public.stores st, checked c
where s.store_id=st.id and st.slug=c.slug;

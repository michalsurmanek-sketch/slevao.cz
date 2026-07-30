-- Slevao.cz: doplnění log obchodů podle oficiálních domén
with store_domains(slug, domain) as (
  values
    ('hruska','mojehruska.cz'),('enapo','enapo.cz'),('flop','flop.cz'),
    ('terno','terno.cz'),('jip','jip-potraviny.cz'),('norma','norma-online.de'),
    ('zabka','zabka.cz'),('dm','dm.cz'),('rossmann','rossmann.cz'),
    ('teta','tetadrogerie.cz'),('action','action.com'),('tedi','tedi.com'),
    ('pepco','pepco.cz'),('kik','kik.cz'),('takko','takko.com'),
    ('sinsay','sinsay.com'),('new-yorker','newyorker.de'),('ca','c-and-a.com'),
    ('hm','hm.com'),('reserved','reserved.com'),('house','housebrand.com'),
    ('cropp','cropp.com'),('obi','obi.cz'),('hornbach','hornbach.cz'),
    ('bauhaus','bauhaus.cz'),('mountfield','mountfield.cz'),('dek','dek.cz'),
    ('pro-doma','pro-doma.cz'),('stavmat','stavmat.cz'),('datart','datart.cz'),
    ('planeo','planeo.cz'),('alza','alza.cz'),('smarty','smarty.cz'),
    ('ikea','ikea.com'),('jysk','jysk.cz'),('moebelix','moebelix.cz'),
    ('sconto','sconto.cz'),('asko','asko-nabytek.cz'),('xxxlutz','xxxlutz.cz'),
    ('decathlon','decathlon.cz'),('sportisimo','sportisimo.cz'),
    ('intersport','intersport.cz'),('super-zoo','superzoo.cz'),
    ('petcenter','petcenter.cz'),('dr-max','drmax.cz'),('benu','benu.cz'),
    ('pilulka','pilulka.cz'),('auto-kelly','autokelly.cz')
)
update public.stores s
set logo_url = 'https://www.google.com/s2/favicons?sz=256&domain_url=https://' || d.domain
from store_domains d
where s.slug = d.slug
  and (s.logo_url is null or btrim(s.logo_url) = '' or s.logo_url like '%clearbit%');

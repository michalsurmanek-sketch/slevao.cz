-- Slevao.cz: logo pro každou veřejnou stránku obchodu.
-- Google S2 vrací aktuální ikonu z oficiální domény značky. Ručně uložené
-- lokální logo má přednost a tato migrace ho nikdy nepřepisuje.
with store_domains(slug, domain) as (
  values
    ('action','action.com'),('albert','albert.cz'),('alza','alza.cz'),
    ('asko','asko-nabytek.cz'),('auto-kelly','autokelly.cz'),('bauhaus','bauhaus.cz'),
    ('benu','benu.cz'),('billa','billa.cz'),('brnenka','brnenka.cz'),
    ('ca','c-and-a.com'),('cba','cba.cz'),('coop','coop.cz'),('cropp','cropp.com'),
    ('datart','datart.cz'),('decathlon','decathlon.cz'),('dek','dek.cz'),
    ('dm','dm.cz'),('dr-max','drmax.cz'),('enapo','enapo.cz'),
    ('eso-market','esomarket.cz'),('flop','flop-potraviny.cz'),('globus','globus.cz'),
    ('hm','hm.com'),('hornbach','hornbach.cz'),('house','housebrand.com'),
    ('hruska','mojehruska.cz'),('ikea','ikea.com'),('intersport','intersport.cz'),
    ('jednota','jednota.cz'),('jip','jip-potraviny.cz'),('jysk','jysk.cz'),
    ('kaufland','kaufland.cz'),('kik','kik.cz'),('konzum','konzumuo.cz'),
    ('kosik','kosik.cz'),('kubik','kubik.cz'),('lidl','lidl.cz'),('makro','makro.cz'),
    ('moebelix','moebelix.cz'),('mountfield','mountfield.cz'),
    ('new-yorker','newyorker.de'),('norma','norma-online.de'),('obi','obi.cz'),
    ('okay','okay.cz'),('penny','penny.cz'),('pepco','pepco.cz'),
    ('petcenter','petcenter.cz'),('pilulka','pilulka.cz'),('planeo','planeo.cz'),
    ('potraviny-muj-obchod','mujobchod.cz'),('pramen-cz','pramen.cz'),
    ('pro-doma','pro-doma.cz'),('ratio','ratio.cz'),('reserved','reserved.com'),
    ('rohlik','rohlik.cz'),('rosa-market','rosamarket.cz'),
    ('rossmann','rossmann.cz'),('sconto','sconto.cz'),('sinsay','sinsay.com'),
    ('smarty','smarty.cz'),('sportisimo','sportisimo.cz'),('stavmat','stavmat.cz'),
    ('super-zoo','superzoo.cz'),('takko','takko.com'),('tamda','tamdafoods.eu'),
    ('tedi','tedi.com'),('tempo','tempo.cz'),('terno','terno.cz'),
    ('tesco','itesco.cz'),('teta','tetadrogerie.cz'),('trefa','trefa.cz'),
    ('xxxlutz','xxxlutz.cz'),('zabka','zabka.cz')
)
update public.stores s
set logo_url = 'https://www.google.com/s2/favicons?sz=256&domain_url=https://' || d.domain
from store_domains d
where s.slug = d.slug
  and (
    s.logo_url is null
    or btrim(s.logo_url) = ''
    or s.logo_url like 'https://www.google.com/s2/favicons%'
    or s.logo_url like '%clearbit%'
  );


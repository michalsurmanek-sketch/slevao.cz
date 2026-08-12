-- Keep the public store detail CTA aligned with the official fallback URLs
-- already returned by store-leaflet-feed for stores without embeddable leaflets.
with official_urls(slug,website_url) as (
  values
    ('alza','https://www.alza.cz/vyprodej-akce-sleva/e0.htm'),
    ('auto-kelly','https://www.autokelly.cz/page/vernostni-program'),
    ('datart','https://www.datart.cz/letak'),
    ('decathlon','https://www.decathlon.cz/deals/doprodej'),
    ('dek','https://www.dek.cz/akce/nabidka/'),
    ('hm','https://www2.hm.com/cs_cz/zeny/vyprodej/zobrazit-vse.html'),
    ('hornbach','https://www.hornbach.cz/aktuality/katalogy/'),
    ('new-yorker','https://www.newyorker.de/cz/'),
    ('pilulka','https://www.pilulka.cz/akce-a-slevy'),
    ('pro-doma','https://www.pro-doma.cz/akce-a-slevy'),
    ('sconto','https://www.sconto.cz/letak'),
    ('smarty','https://www.smarty.cz/vyprodej-4c10260'),
    ('sportisimo','https://www.sportisimo.cz/vyprodej/'),
    ('stavmat','https://www.stavmat.cz/akce/'),
    ('super-zoo','https://www.superzoo.cz/akce/'),
    ('tedi','https://www.tedi.com/cz/'),
    ('xxxlutz','https://www.xxxlutz.cz/c/letaky')
)
update public.stores s
set website_url=o.website_url,updated_at=now()
from official_urls o
where s.slug=o.slug and s.website_url is null;

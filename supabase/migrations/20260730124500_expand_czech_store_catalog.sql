-- Slevao.cz: rozšíření katalogu českých obchodních řetězců
-- Obchody jsou aktivní pro zobrazení. Nové zdroje letáků jsou záměrně neaktivní,
-- dokud neprojdou testem parseru a kontroly kvality dat.

with store_seed(slug, name, logo_url, primary_color) as (
  values
    ('coop', 'COOP', null, '#e31e24'),
    ('rohlik', 'Rohlík.cz', null, '#7b1fa2'),
    ('kosik', 'Košík.cz', null, '#ff6b00'),
    ('hruska', 'Hruška', null, '#e30613'),
    ('enapo', 'Enapo', null, '#e30613'),
    ('flop', 'Flop', null, '#e30613'),
    ('terno', 'Terno', null, '#00843d'),
    ('jip', 'JIP', null, '#d71920'),
    ('norma', 'Norma', null, '#005ca9'),
    ('zabka', 'Žabka', null, '#74b82a'),
    ('dm', 'dm drogerie markt', null, '#003b7a'),
    ('rossmann', 'ROSSMANN', null, '#e30613'),
    ('teta', 'Teta drogerie', null, '#e6007e'),
    ('action', 'Action', null, '#0066b3'),
    ('tedi', 'TEDi', null, '#e30613'),
    ('pepco', 'Pepco', null, '#003b7a'),
    ('kik', 'KiK', null, '#e30613'),
    ('takko', 'Takko Fashion', null, '#e30613'),
    ('sinsay', 'Sinsay', null, '#111111'),
    ('new-yorker', 'New Yorker', null, '#111111'),
    ('ca', 'C&A', null, '#d71920'),
    ('hm', 'H&M', null, '#e50010'),
    ('reserved', 'Reserved', null, '#111111'),
    ('house', 'House', null, '#111111'),
    ('cropp', 'Cropp', null, '#111111'),
    ('obi', 'OBI', null, '#f58220'),
    ('hornbach', 'Hornbach', null, '#f58220'),
    ('bauhaus', 'Bauhaus', null, '#e30613'),
    ('mountfield', 'Mountfield', null, '#00843d'),
    ('dek', 'DEK', null, '#f58220'),
    ('pro-doma', 'PRO-DOMA', null, '#e30613'),
    ('stavmat', 'STAVMAT', null, '#005ca9'),
    ('datart', 'DATART', null, '#e30613'),
    ('planeo', 'PLANEO', null, '#e30613'),
    ('alza', 'Alza.cz', null, '#78be20'),
    ('smarty', 'Smarty.cz', null, '#111111'),
    ('ikea', 'IKEA', null, '#0058a3'),
    ('jysk', 'JYSK', null, '#0058a3'),
    ('moebelix', 'Möbelix', null, '#e30613'),
    ('sconto', 'Sconto Nábytek', null, '#e30613'),
    ('asko', 'ASKO Nábytek', null, '#e30613'),
    ('xxxlutz', 'XXXLutz', null, '#e30613'),
    ('decathlon', 'Decathlon', null, '#007dbc'),
    ('sportisimo', 'Sportisimo', null, '#e30613'),
    ('intersport', 'Intersport', null, '#e30613'),
    ('super-zoo', 'Super zoo', null, '#74b82a'),
    ('petcenter', 'PetCenter', null, '#e30613'),
    ('dr-max', 'Dr. Max', null, '#00843d'),
    ('benu', 'BENU', null, '#74b82a'),
    ('pilulka', 'Pilulka.cz', null, '#e6007e'),
    ('auto-kelly', 'Auto Kelly', null, '#e30613')
)
insert into public.stores (slug, name, logo_url, primary_color, is_active)
select slug, name, logo_url, primary_color, true
from store_seed
on conflict (slug) do update set
  name = excluded.name,
  primary_color = excluded.primary_color,
  is_active = true;

with source_seed(slug, name, source_url, source_type, check_interval_minutes) as (
  values
    ('coop', 'COOP – letáky', 'https://www.coop.cz/letaky', 'html', 360),
    ('hruska', 'Hruška – akční leták', 'https://www.mojehruska.cz/akcni-letak', 'html', 360),
    ('enapo', 'Enapo – akční leták', 'https://www.enapo.cz/akcni-letak', 'html', 360),
    ('flop', 'Flop – akční leták', 'https://www.flop.cz/akcni-letak', 'html', 360),
    ('terno', 'Terno – letáky', 'https://www.terno.cz/letaky', 'html', 360),
    ('jip', 'JIP – akční nabídka', 'https://www.jip-potraviny.cz/akcni-nabidka', 'html', 360),
    ('norma', 'Norma – aktuální nabídka', 'https://www.norma-online.de/cz/angebote/', 'html', 360),
    ('zabka', 'Žabka – akce', 'https://www.zabka.cz/akce', 'html', 360),
    ('dm', 'dm – aktuální nabídky', 'https://www.dm.cz/aktualni-nabidky', 'html', 720),
    ('rossmann', 'ROSSMANN – akční leták', 'https://www.rossmann.cz/akcni-letak', 'html', 360),
    ('teta', 'Teta – akční nabídka', 'https://www.tetadrogerie.cz/akcni-nabidka', 'html', 360),
    ('action', 'Action – týdenní nabídka', 'https://www.action.com/cs-cz/tydenni-nabidka/', 'html', 360),
    ('tedi', 'TEDi – prospekt', 'https://www.tedi.com/cz/aktualne/prospekt', 'html', 720),
    ('pepco', 'Pepco – leták', 'https://pepco.cz/letak/', 'html', 360),
    ('kik', 'KiK – prospekt', 'https://www.kik.cz/prospekt', 'html', 720),
    ('takko', 'Takko – nabídky', 'https://www.takko.com/cs-cz/akcni-nabidky/', 'html', 720),
    ('obi', 'OBI – leták a nabídky', 'https://www.obi.cz/letak', 'html', 360),
    ('hornbach', 'Hornbach – aktuální nabídky', 'https://www.hornbach.cz/aktualni-nabidky/', 'html', 360),
    ('bauhaus', 'Bauhaus – akční nabídky', 'https://www.bauhaus.cz/akcni-nabidky', 'html', 360),
    ('mountfield', 'Mountfield – akční nabídky', 'https://www.mountfield.cz/akcni-nabidky', 'html', 360),
    ('dek', 'DEK – akční nabídky', 'https://www.dek.cz/akce', 'html', 720),
    ('datart', 'DATART – leták', 'https://www.datart.cz/letak.html', 'html', 360),
    ('planeo', 'PLANEO – akční leták', 'https://www.planeo.cz/akcni-letak', 'html', 360),
    ('alza', 'Alza – akce', 'https://www.alza.cz/akce', 'html', 360),
    ('ikea', 'IKEA – nabídky', 'https://www.ikea.com/cz/cs/offers/', 'html', 720),
    ('jysk', 'JYSK – leták', 'https://jysk.cz/letak', 'html', 360),
    ('moebelix', 'Möbelix – leták', 'https://www.moebelix.cz/c/letak', 'html', 720),
    ('sconto', 'Sconto – akční leták', 'https://www.sconto.cz/akcni-letak', 'html', 720),
    ('asko', 'ASKO – leták', 'https://www.asko-nabytek.cz/letak', 'html', 720),
    ('xxxlutz', 'XXXLutz – leták', 'https://www.xxxlutz.cz/c/letak', 'html', 720),
    ('decathlon', 'Decathlon – nabídky', 'https://www.decathlon.cz/vsechny-sporty/akce', 'html', 720),
    ('sportisimo', 'Sportisimo – akce', 'https://www.sportisimo.cz/akce/', 'html', 360),
    ('super-zoo', 'Super zoo – leták', 'https://www.superzoo.cz/letak/', 'html', 360),
    ('petcenter', 'PetCenter – akce', 'https://www.petcenter.cz/akce/', 'html', 360),
    ('dr-max', 'Dr. Max – akční nabídky', 'https://www.drmax.cz/akce', 'html', 360),
    ('benu', 'BENU – akce', 'https://www.benu.cz/akce', 'html', 360),
    ('pilulka', 'Pilulka – akce', 'https://www.pilulka.cz/akce', 'html', 360),
    ('auto-kelly', 'Auto Kelly – akční nabídky', 'https://www.autokelly.cz/akce', 'html', 720)
)
insert into public.leaflet_sources (
  store_id, name, source_url, source_type, is_active, auto_publish,
  check_interval_minutes, coverage_scope, last_checked_at, last_error
)
select
  s.id, seed.name, seed.source_url, seed.source_type, false, false,
  seed.check_interval_minutes, 'national', null, 'Čeká na první kontrolu parseru'
from source_seed seed
join public.stores s on s.slug = seed.slug
on conflict (source_url) do update set
  store_id = excluded.store_id,
  name = excluded.name,
  source_type = excluded.source_type,
  check_interval_minutes = excluded.check_interval_minutes,
  coverage_scope = 'national';

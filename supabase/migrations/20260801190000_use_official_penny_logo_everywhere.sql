-- Jeden skutečný logotyp PENNY pro všechny veřejné i administrační výstupy.
-- Relativní URL míří na verzovaný lokální SVG soubor nasazený se statickým webem.
update public.stores
set logo_url = 'assets/logos/penny.svg?v=4',
    primary_color = '#cd1316'
where slug = 'penny';


-- Intersport stránka /akce/ vrací v aplikačních datech odkazy na kampaně,
-- jejichž detailní stránky jsou již 404. Zdroj nesmí být vedený jako úspěšný,
-- dokud obchod nezveřejní nový strojově ověřitelný leták nebo nabídky.

update public.leaflet_sources ls
set is_active = false,
    last_checked_at = now(),
    last_error = 'Oficiální stránka odkazuje na neexistující detailní kampaně (HTTP 404); zdroj byl bezpečně vypnut.',
    updated_at = now()
from public.stores s
where ls.store_id = s.id
  and s.slug = 'intersport'
  and ls.is_active = true;

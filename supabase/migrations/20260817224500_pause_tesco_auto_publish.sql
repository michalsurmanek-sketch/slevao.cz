-- Safety gate: publish-imports currently performs Tesco full replacement non-transactionally.
-- Keep discovery/processing active, but require review until the replacement path is atomic.
update public.leaflet_sources ls
set auto_publish = false,
    updated_at = now()
from public.stores s
where s.id = ls.store_id
  and s.slug = 'tesco'
  and ls.auto_publish is distinct from false;

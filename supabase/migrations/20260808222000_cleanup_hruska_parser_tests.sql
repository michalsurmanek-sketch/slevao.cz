delete from public.leaflet_imports li
using public.stores s
where li.store_id = s.id
  and s.slug = 'hruska'
  and li.status = 'review'
  and coalesce(li.metadata->>'parser_test', 'false') = 'true'
  and coalesce(li.metadata->>'purpose', '') = 'hruska-deterministic-parser';

update public.leaflet_imports li
set metadata = (coalesce(li.metadata, '{}'::jsonb) - 'parser_test' - 'purpose') || jsonb_build_object('verified_pipeline_seed', true)
from public.stores s
where li.store_id = s.id
  and s.slug = 'hruska'
  and li.status = 'published'
  and coalesce(li.metadata->>'parser_test', 'false') = 'true'
  and coalesce(li.metadata->>'purpose', '') = 'hruska-coordinate-parser';

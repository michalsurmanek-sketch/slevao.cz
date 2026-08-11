-- BENU v3 extracts the sold package quantity (for example 30 ks) instead of
-- the active-ingredient dose (for example 400MG). Backfill products that were
-- linked to older catalogue rows and keep their aliases consistent.

with benu_store as (
  select id from public.stores where slug = 'benu'
), source_rows as (
  select distinct on (li.product_id)
    li.product_id,
    li.quantity_text
  from public.leaflet_import_items li
  join public.leaflet_imports imp on imp.id = li.import_id
  join benu_store bs on bs.id = imp.store_id
  where li.product_id is not null
    and coalesce(li.quantity_text, '') <> ''
    and li.raw_data ->> 'parser' = 'benu-html-v3'
    and public.product_quantity_key(li.quantity_text) = public.product_quantity_key(li.title)
  order by li.product_id, imp.created_at desc, li.created_at desc
), repaired as (
  update public.products p
  set quantity_text = s.quantity_text,
      metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object(
        '_benu_package_quantity_repaired_at', now(),
        '_benu_package_quantity_source', 'benu-html-v3'
      ),
      updated_at = now()
  from source_rows s
  where p.id = s.product_id
    and public.product_quantity_key(coalesce(p.quantity_text, p.name))
        is distinct from public.product_quantity_key(s.quantity_text)
  returning p.id, s.quantity_text
)
update public.product_aliases a
set quantity_text = r.quantity_text,
    updated_at = now()
from repaired r, benu_store bs
where a.product_id = r.id
  and a.source_store_id = bs.id;

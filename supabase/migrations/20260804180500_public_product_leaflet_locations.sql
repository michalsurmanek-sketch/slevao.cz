create or replace view public.public_product_leaflet_locations
with (security_invoker = false)
as
select distinct on (item.product_id, imp.store_id, item.source_page)
  item.product_id,
  item.source_page,
  imp.id as import_id,
  imp.store_id,
  s.name as store_name,
  s.slug as store_slug,
  imp.detected_valid_from as valid_from,
  imp.detected_valid_to as valid_to,
  imp.page_count,
  coalesce(nullif(imp.metadata->>'source_original_url',''), imp.source_document_url) as document_url
from public.leaflet_import_items item
join public.leaflet_imports imp on imp.id = item.import_id
join public.stores s on s.id = imp.store_id
where item.product_id is not null
  and item.source_page is not null
  and imp.status in ('completed','published','processed')
  and coalesce(imp.detected_valid_to, current_date) >= current_date - 30
order by item.product_id, imp.store_id, item.source_page, imp.created_at desc;

grant select on public.public_product_leaflet_locations to anon, authenticated;

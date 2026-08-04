with latest_values as (
  select distinct on (li.product_id)
         li.product_id,
         nullif(trim(coalesce(li.brand, li.raw_data->>'brand')),'') as brand,
         nullif(trim(coalesce(li.quantity_text, li.raw_data->>'quantity_text')),'') as quantity_text
  from public.leaflet_import_items li
  where li.product_id is not null
    and (
      nullif(trim(coalesce(li.brand, li.raw_data->>'brand')),'') is not null
      or nullif(trim(coalesce(li.quantity_text, li.raw_data->>'quantity_text')),'') is not null
    )
  order by li.product_id, li.created_at desc
)
update public.products p
set brand = coalesce(nullif(trim(p.brand),''), latest_values.brand),
    quantity_text = coalesce(nullif(trim(p.quantity_text),''), latest_values.quantity_text),
    updated_at = now()
from latest_values
where p.id=latest_values.product_id
  and (
    (nullif(trim(p.brand),'') is null and latest_values.brand is not null)
    or (nullif(trim(p.quantity_text),'') is null and latest_values.quantity_text is not null)
  );
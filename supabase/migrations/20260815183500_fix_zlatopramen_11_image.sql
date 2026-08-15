-- Kaufland klNr 02312871 currently carries a Krušovice PET image.
update public.offers
set image_url = 'https://cdn.globusonline.cz/content/images/product/zlatopramen-11-pivo-lezak-svetly-plech-0-5-l_1250.jpg', updated_at = now()
where metadata ->> 'adapter' = 'kaufland-products-v4-ssr'
  and metadata ->> 'kaufland_kl_nr' = '02312871';

update public.products p
set image_url = 'https://cdn.globusonline.cz/content/images/product/zlatopramen-11-pivo-lezak-svetly-plech-0-5-l_1250.jpg', updated_at = now()
where exists (
  select 1 from public.offers o
  where o.product_id = p.id
    and o.metadata ->> 'adapter' = 'kaufland-products-v4-ssr'
    and o.metadata ->> 'kaufland_kl_nr' = '02312871'
);

update public.leaflet_import_items
set image_url = 'https://cdn.globusonline.cz/content/images/product/zlatopramen-11-pivo-lezak-svetly-plech-0-5-l_1250.jpg'
where raw_data ->> 'adapter' = 'kaufland-products-v4-ssr'
  and raw_data ->> 'kl_nr' = '02312871';

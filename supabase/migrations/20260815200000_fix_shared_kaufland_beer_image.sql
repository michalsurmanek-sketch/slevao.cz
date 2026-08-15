-- Kaufland currently reuses a Krušovice PET image for unrelated beer SKUs.
update public.offers
set
  image_url = case
    when metadata ->> 'kaufland_kl_nr' = '02312090' then 'https://static-new.kosik.cz/k3wCdnContainerk3w-static-ne-cz-prod/images/thumbs/ln/600x600x1_lnow9maersia.png'
    else null
  end,
  updated_at = now()
where metadata ->> 'adapter' = 'kaufland-products-v4-ssr'
  and image_url = 'https://kaufland.media.schwarz/is/image/schwarz/8594009923191_CZ_P'
  and public.normalize_product_name(title) not like '%krusovice%';

update public.products p
set
  image_url = case
    when exists (
      select 1 from public.offers o
      where o.product_id = p.id and o.metadata ->> 'kaufland_kl_nr' = '02312090'
    ) then 'https://static-new.kosik.cz/k3wCdnContainerk3w-static-ne-cz-prod/images/thumbs/ln/600x600x1_lnow9maersia.png'
    else null
  end,
  image_verified = case
    when exists (
      select 1 from public.offers o
      where o.product_id = p.id and o.metadata ->> 'kaufland_kl_nr' = '02312090'
    ) then true
    else false
  end,
  updated_at = now()
where p.image_url = 'https://kaufland.media.schwarz/is/image/schwarz/8594009923191_CZ_P'
  and public.normalize_product_name(p.name) not like '%krusovice%';

update public.leaflet_import_items
set image_url = case
  when raw_data ->> 'kl_nr' = '02312090' then 'https://static-new.kosik.cz/k3wCdnContainerk3w-static-ne-cz-prod/images/thumbs/ln/600x600x1_lnow9maersia.png'
  else null
end
where raw_data ->> 'adapter' = 'kaufland-products-v4-ssr'
  and image_url = 'https://kaufland.media.schwarz/is/image/schwarz/8594009923191_CZ_P'
  and public.normalize_product_name(title) not like '%krusovice%';

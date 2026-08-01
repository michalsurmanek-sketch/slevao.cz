-- Produkty s fotografií čekající na schválení už nejsou „bez fotografie“.
-- Po zamítnutí posledního kandidáta se automaticky objeví zpět v seznamu.

create or replace view public.products_missing_verified_images as
select
  p.id,
  p.name,
  p.brand,
  p.ean,
  p.quantity_text,
  count(distinct o.id) filter (where o.status = 'published') as active_offer_count,
  count(distinct o.store_id) filter (where o.status = 'published') as active_store_count,
  max(o.published_at) as last_offer_at,
  p.image_checked_at
from public.products p
left join public.offers o on o.product_id = p.id
where (
  p.image_url is null
  or p.image_verified = false
  or coalesce(p.image_quality, 0) < 70
)
and not exists (
  select 1
  from public.product_image_candidates candidate
  where candidate.product_id = p.id
    and candidate.status in ('pending', 'approved')
)
group by p.id, p.name, p.brand, p.ean, p.quantity_text, p.image_checked_at;

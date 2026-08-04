create or replace view public.products_missing_verified_images as
select
  p.id,
  p.name,
  p.brand,
  p.ean,
  p.quantity_text,
  count(distinct o.id) filter (where o.status='published') as active_offer_count,
  count(distinct o.store_id) filter (where o.status='published') as active_store_count,
  max(o.published_at) as last_offer_at,
  case
    when p.image_checked_at is not null then p.image_checked_at
    when p.ean ~ '^\d{8,14}$' then timestamptz '1900-01-01 00:00:00+00'
    when nullif(trim(p.brand),'') is not null then timestamptz '1901-01-01 00:00:00+00'
    when split_part(trim(p.name),' ',1) ~ '^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ0-9][A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ0-9&.!''-]{2,}$' then timestamptz '1902-01-01 00:00:00+00'
    when nullif(trim(p.quantity_text),'') is not null then timestamptz '1903-01-01 00:00:00+00'
    else timestamptz '1904-01-01 00:00:00+00'
  end as image_checked_at
from public.products p
left join public.offers o on o.product_id=p.id
where (p.image_url is null or p.image_verified=false or coalesce(p.image_quality::integer,0)<70)
  and not exists (
    select 1 from public.product_image_candidates candidate
    where candidate.product_id=p.id and candidate.status in ('pending','approved')
  )
group by p.id,p.name,p.brand,p.ean,p.quantity_text,p.image_checked_at;
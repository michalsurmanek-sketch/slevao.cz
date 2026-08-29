create or replace view public.products_missing_verified_images
with (security_invoker = true)
as
with offer_stats as (
  select
    o.product_id,
    count(*) filter (where o.status = 'published')::bigint as active_offer_count,
    count(distinct o.store_id) filter (where o.status = 'published')::bigint as active_store_count,
    max(o.published_at) as last_offer_at
  from public.offers o
  where o.product_id is not null
  group by o.product_id
  having count(*) filter (where o.status = 'published') > 0
)
select
  p.id,p.name,p.brand,p.ean,p.quantity_text,
  s.active_offer_count,s.active_store_count,s.last_offer_at,
  case
    when p.image_checked_at is not null then p.image_checked_at
    when p.ean ~ '^\d{8,14}$' then '1900-01-01 00:00:00+00'::timestamptz
    when nullif(trim(p.brand), '') is not null then '1901-01-01 00:00:00+00'::timestamptz
    when split_part(trim(p.name), ' ', 1) ~ '^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ0-9][A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ0-9&.!''-]{2,}$' then '1902-01-01 00:00:00+00'::timestamptz
    when nullif(trim(p.quantity_text), '') is not null then '1903-01-01 00:00:00+00'::timestamptz
    else '1904-01-01 00:00:00+00'::timestamptz
  end as image_checked_at
from offer_stats s
join public.products p on p.id=s.product_id
where (p.image_url is null or p.image_verified=false or coalesce(p.image_quality::integer,0)<70)
  and not exists (
    select 1 from public.product_image_candidates candidate
    where candidate.product_id=p.id and candidate.status in ('pending','approved')
  );

grant select, references on public.products_missing_verified_images to authenticated;
grant all on public.products_missing_verified_images to service_role;

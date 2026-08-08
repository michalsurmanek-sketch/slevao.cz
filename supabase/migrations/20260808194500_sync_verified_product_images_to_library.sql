-- Slevao.cz: každá ověřená produktová fotografie se ukládá i do trvalé knihovny.
-- Týká se ručních i automaticky získaných fotografií (např. official_kaufland).

create or replace function public.sync_verified_product_image_to_library()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_type text;
begin
  if new.image_verified is not true
     or coalesce(new.image_quality, 0) < 70
     or coalesce(btrim(new.image_url), '') = ''
     or new.image_url like '%/leaflet-crops/%' then
    return new;
  end if;

  v_source_type := case
    when coalesce(new.image_source, '') like 'official_%' then 'retailer'
    when new.image_url like '%/product-images/manual/%'
      or new.image_url like '%/assets/product-images/chatgpt/%'
      or new.image_url like '%-chatgpt-%' then 'manual'
    else 'retailer'
  end;

  update public.product_image_library
  set is_active = false,
      updated_at = now()
  where product_id = new.id
    and is_active = true
    and image_url is distinct from new.image_url;

  insert into public.product_image_library(
    product_id,
    image_url,
    source_url,
    source_domain,
    source_type,
    quality_score,
    is_active,
    approved_at
  ) values (
    new.id,
    new.image_url,
    new.image_url,
    case when coalesce(new.image_source, '') like 'official_%' then new.image_source else null end,
    v_source_type,
    greatest(coalesce(new.image_quality, 0), 70),
    true,
    coalesce(new.image_checked_at, now())
  )
  on conflict (product_id, image_url)
  do update set
    source_url = excluded.source_url,
    source_domain = coalesce(excluded.source_domain, product_image_library.source_domain),
    source_type = excluded.source_type,
    quality_score = greatest(product_image_library.quality_score, excluded.quality_score),
    is_active = true,
    approved_at = excluded.approved_at,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists products_sync_verified_image_library_trigger on public.products;
create trigger products_sync_verified_image_library_trigger
after insert or update of image_url, image_source, image_quality, image_verified on public.products
for each row execute function public.sync_verified_product_image_to_library();

-- Srovnej už existující ověřené produktové fotografie s knihovnou.
update public.product_image_library l
set is_active = false,
    updated_at = now()
from public.products p
where p.id = l.product_id
  and p.image_verified = true
  and coalesce(p.image_quality, 0) >= 70
  and coalesce(btrim(p.image_url), '') <> ''
  and p.image_url not like '%/leaflet-crops/%'
  and l.is_active = true
  and l.image_url is distinct from p.image_url;

insert into public.product_image_library(
  product_id,
  image_url,
  source_url,
  source_domain,
  source_type,
  quality_score,
  is_active,
  approved_at
)
select
  p.id,
  p.image_url,
  p.image_url,
  case when coalesce(p.image_source, '') like 'official_%' then p.image_source else null end,
  case
    when coalesce(p.image_source, '') like 'official_%' then 'retailer'
    when p.image_url like '%/product-images/manual/%'
      or p.image_url like '%/assets/product-images/chatgpt/%'
      or p.image_url like '%-chatgpt-%' then 'manual'
    else 'retailer'
  end,
  greatest(coalesce(p.image_quality, 0), 70),
  true,
  coalesce(p.image_checked_at, now())
from public.products p
where p.image_verified = true
  and coalesce(p.image_quality, 0) >= 70
  and coalesce(btrim(p.image_url), '') <> ''
  and p.image_url not like '%/leaflet-crops/%'
on conflict (product_id, image_url)
do update set
  source_url = excluded.source_url,
  source_domain = coalesce(excluded.source_domain, product_image_library.source_domain),
  source_type = excluded.source_type,
  quality_score = greatest(product_image_library.quality_score, excluded.quality_score),
  is_active = true,
  approved_at = excluded.approved_at,
  updated_at = now();

revoke all on function public.sync_verified_product_image_to_library() from public, anon, authenticated;

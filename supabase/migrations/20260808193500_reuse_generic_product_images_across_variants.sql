-- Slevao.cz: neznačkové produkty nesmí dostávat nový obrázek jen kvůli gramáži / kusům v názvu.
-- Příklad: "Cuketa zelená" a "Cuketa zelená · 1 kg" používají jeden ověřený obrázek.

create or replace function public.generic_product_image_key(p_name text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := public.normalize_product_name(coalesce(p_name, ''));
begin
  -- Odstraň pouze koncovou prodejní jednotku/gramáž; samotný název produktu zůstává zachován.
  v := regexp_replace(
    v,
    '\s+(cena\s+za\s+)?[0-9]+(\s+[0-9]+)?\s*(kg|g|l|ml|ks|kus)?(\s+baleni)?\s*$',
    '',
    'i'
  );
  return btrim(v);
end;
$$;

create or replace function public.best_reusable_generic_product_image(
  p_name text,
  p_brand text default null,
  p_exclude_product_id uuid default null
)
returns table(
  image_url text,
  image_source text,
  image_quality smallint,
  source_product_id uuid
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.image_url,
    p.image_source,
    p.image_quality,
    p.id
  from public.products p
  where public.generic_product_image_key(p_name) <> ''
    and nullif(btrim(coalesce(p_brand, '')), '') is null
    and nullif(btrim(coalesce(p.brand, '')), '') is null
    and public.generic_product_image_key(p.name) = public.generic_product_image_key(p_name)
    and (p_exclude_product_id is null or p.id <> p_exclude_product_id)
    and p.image_verified = true
    and coalesce(p.image_quality, 0) >= 70
    and p.image_url is not null
    and btrim(p.image_url) <> ''
    and p.image_url not like '%/leaflet-crops/%'
  order by
    case
      when p.image_source like 'official_%' then 0
      when p.image_url like '%/product-images/manual/%' then 1
      else 2
    end,
    p.image_quality desc,
    p.image_checked_at desc nulls last,
    p.updated_at desc
  limit 1;
$$;

create or replace function public.active_verified_product_image(p_product_id uuid)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (
      select l.image_url
      from public.product_image_library l
      where l.product_id = p_product_id
        and l.is_active = true
        and l.quality_score >= 70
      order by l.quality_score desc, l.approved_at desc
      limit 1
    ),
    (
      select p.image_url
      from public.products p
      where p.id = p_product_id
        and p.image_verified = true
        and coalesce(p.image_quality, 0) >= 70
        and p.image_url is not null
        and btrim(p.image_url) <> ''
        and p.image_url not like '%/leaflet-crops/%'
    ),
    (
      select r.image_url
      from public.products target
      cross join lateral public.best_reusable_generic_product_image(
        target.name,
        target.brand,
        target.id
      ) r
      where target.id = p_product_id
      limit 1
    )
  );
$$;

create or replace function public.apply_reusable_generic_image_to_product()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  reused record;
begin
  if coalesce(btrim(new.image_url), '') <> '' then
    return new;
  end if;

  if nullif(btrim(coalesce(new.brand, '')), '') is not null then
    return new;
  end if;

  select * into reused
  from public.best_reusable_generic_product_image(new.name, new.brand, new.id)
  limit 1;

  if reused.image_url is not null then
    new.image_url := reused.image_url;
    new.image_source := coalesce(reused.image_source, reused.image_url);
    new.image_quality := greatest(coalesce(reused.image_quality, 0), 70);
    new.image_verified := true;
    new.image_checked_at := now();
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'image_reused_from_product_id', reused.source_product_id::text,
      'image_reuse_key', public.generic_product_image_key(new.name)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists products_reuse_generic_image_trigger on public.products;
create trigger products_reuse_generic_image_trigger
before insert or update of name, brand, image_url on public.products
for each row execute function public.apply_reusable_generic_image_to_product();

-- Doplnění již existujících duplicitních/variantních neznačkových produktů bez obrázku.
with reusable as (
  select p.id, r.image_url, r.image_source, r.image_quality, r.source_product_id
  from public.products p
  cross join lateral public.best_reusable_generic_product_image(p.name, p.brand, p.id) r
  where coalesce(btrim(p.image_url), '') = ''
    and nullif(btrim(coalesce(p.brand, '')), '') is null
)
update public.products p
set image_url = r.image_url,
    image_source = coalesce(r.image_source, r.image_url),
    image_quality = greatest(coalesce(r.image_quality, 0), 70),
    image_verified = true,
    image_checked_at = now(),
    metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object(
      'image_reused_from_product_id', r.source_product_id::text,
      'image_reuse_key', public.generic_product_image_key(p.name)
    )
from reusable r
where p.id = r.id;

-- Pokud jsme zbytečně vytvořili ChatGPT obrázek a pro stejný neznačkový produkt už existuje
-- ověřená oficiální produktová fotografie, vrať oficiální fotografii.
with official_replacement as (
  select p.id, r.image_url, r.image_source, r.image_quality, r.source_product_id
  from public.products p
  cross join lateral public.best_reusable_generic_product_image(p.name, p.brand, p.id) r
  where nullif(btrim(coalesce(p.brand, '')), '') is null
    and (
      p.image_url like '%/assets/product-images/chatgpt/%'
      or p.image_url like '%-chatgpt-%'
    )
    and r.image_source like 'official_%'
)
update public.products p
set image_url = r.image_url,
    image_source = r.image_source,
    image_quality = greatest(coalesce(r.image_quality, 0), 70),
    image_verified = true,
    image_checked_at = now(),
    metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object(
      'image_reused_from_product_id', r.source_product_id::text,
      'image_reuse_key', public.generic_product_image_key(p.name),
      'image_replaced_generated_duplicate', true
    )
from official_replacement r
where p.id = r.id;

-- U znovupoužitých produktů udrž hlavní knihovnu ve shodě s products.image_url.
update public.product_image_library l
set is_active = false,
    updated_at = now()
from public.products p
where p.metadata ? 'image_reused_from_product_id'
  and l.product_id = p.id
  and l.is_active = true
  and l.image_url is distinct from p.image_url;

insert into public.product_image_library(
  product_id, image_url, source_url, source_type, quality_score,
  is_active, approved_at
)
select
  p.id,
  p.image_url,
  p.image_url,
  'generic_reuse',
  greatest(coalesce(p.image_quality, 0), 70),
  true,
  now()
from public.products p
where p.metadata ? 'image_reused_from_product_id'
  and p.image_verified = true
  and coalesce(btrim(p.image_url), '') <> ''
on conflict (product_id, image_url)
do update set
  source_url = excluded.source_url,
  source_type = 'generic_reuse',
  quality_score = greatest(public.product_image_library.quality_score, excluded.quality_score),
  is_active = true,
  approved_at = excluded.approved_at,
  updated_at = now();

update public.product_image_candidates c
set status = 'rejected',
    rejection_reason = 'Nahrazeno již existujícím ověřeným obrázkem stejného neznačkového produktu',
    reviewed_at = now(),
    updated_at = now()
from public.products p
where p.metadata ? 'image_reused_from_product_id'
  and c.product_id = p.id
  and c.status = 'approved'
  and c.image_url is distinct from p.image_url;

update public.offers o
set image_url = p.image_url
from public.products p
where p.metadata ? 'image_reused_from_product_id'
  and o.product_id = p.id
  and o.image_url is distinct from p.image_url;

update public.leaflet_import_items li
set image_url = p.image_url
from public.products p
where p.metadata ? 'image_reused_from_product_id'
  and li.product_id = p.id
  and li.image_url is distinct from p.image_url;

revoke all on function public.generic_product_image_key(text) from public, anon, authenticated;
grant execute on function public.generic_product_image_key(text) to service_role;
revoke all on function public.best_reusable_generic_product_image(text,text,uuid) from public, anon, authenticated;
grant execute on function public.best_reusable_generic_product_image(text,text,uuid) to service_role;
revoke all on function public.apply_reusable_generic_image_to_product() from public, anon, authenticated;

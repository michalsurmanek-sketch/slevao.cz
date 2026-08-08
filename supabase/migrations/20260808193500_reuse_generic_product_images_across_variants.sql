-- Slevao.cz: neznačkové produkty nesmí dostávat nový obrázek jen kvůli gramáži / kusům v názvu.
-- Příklad: "Cuketa zelená" a "Cuketa zelená · 1 kg" mají stejný image key.

create or replace function public.generic_product_image_key(p_name text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := public.normalize_product_name(coalesce(p_name, ''));
begin
  v := regexp_replace(
    v,
    '\s+(cena\s+za\s+)?[0-9]+(\s+[0-9]+)?\s*(kg|g|l|ml|ks|kus)?(\s+baleni)?\s*$',
    '',
    'i'
  );
  return btrim(v);
end;
$$;

create index if not exists products_generic_image_key_verified_idx
on public.products (public.generic_product_image_key(name))
where image_verified = true
  and coalesce(image_quality, 0) >= 70
  and image_url is not null
  and btrim(image_url) <> ''
  and image_url not like '%/leaflet-crops/%';

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
  select p.image_url, p.image_source, p.image_quality, p.id
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
      cross join lateral public.best_reusable_generic_product_image(target.name, target.brand, target.id) r
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

revoke all on function public.generic_product_image_key(text) from public, anon, authenticated;
grant execute on function public.generic_product_image_key(text) to service_role;
revoke all on function public.best_reusable_generic_product_image(text,text,uuid) from public, anon, authenticated;
grant execute on function public.best_reusable_generic_product_image(text,text,uuid) to service_role;
revoke all on function public.apply_reusable_generic_image_to_product() from public, anon, authenticated;

create index if not exists products_normalized_name_trgm_idx
on public.products using gin (normalized_name gin_trgm_ops)
where is_active = true;

create index if not exists products_brand_trgm_idx
on public.products using gin (brand gin_trgm_ops)
where is_active = true and brand is not null;

create or replace function public.search_products_catalog(
  search_query text,
  result_limit integer default 120
)
returns table (
  id uuid,
  name text,
  brand text,
  quantity_text text,
  image_url text,
  slug text,
  category_id uuid,
  relevance double precision
)
language sql
stable
security definer
set search_path = public
as $$
  with input as (
    select trim(regexp_replace(unaccent(lower(coalesce(search_query, ''))), '[^a-z0-9]+', ' ', 'g')) as needle
  ), ranked as (
    select
      p.id,
      p.name,
      p.brand,
      p.quantity_text,
      p.image_url,
      p.slug,
      p.category_id,
      (
        case
          when p.normalized_name = i.needle then 120
          when p.normalized_name like i.needle || '%' then 100
          when p.normalized_name like '%' || i.needle || '%' then 82
          else 0
        end
        + case
            when unaccent(lower(coalesce(p.brand, ''))) = i.needle then 32
            when unaccent(lower(coalesce(p.brand, ''))) like i.needle || '%' then 20
            else 0
          end
        + similarity(coalesce(p.normalized_name, ''), i.needle) * 55
        + word_similarity(i.needle, coalesce(p.normalized_name, '')) * 40
        + similarity(unaccent(lower(coalesce(p.brand, ''))), i.needle) * 24
      )::double precision as relevance
    from public.products p
    cross join input i
    where p.is_active = true
      and length(i.needle) >= 2
      and (
        coalesce(p.normalized_name, '') % i.needle
        or word_similarity(i.needle, coalesce(p.normalized_name, '')) >= 0.32
        or coalesce(p.normalized_name, '') like '%' || i.needle || '%'
        or unaccent(lower(coalesce(p.brand, ''))) % i.needle
        or unaccent(lower(coalesce(p.brand, ''))) like '%' || i.needle || '%'
      )
  )
  select r.id, r.name, r.brand, r.quantity_text, r.image_url, r.slug, r.category_id, r.relevance
  from ranked r
  order by r.relevance desc, r.name asc
  limit greatest(1, least(coalesce(result_limit, 120), 200));
$$;

revoke all on function public.search_products_catalog(text, integer) from public;
grant execute on function public.search_products_catalog(text, integer) to anon, authenticated;
create or replace function public.resolve_public_filter_group(
  p_name text,
  p_category_slug text default null::text,
  p_store_slug text default null::text
)
returns text
language plpgsql
immutable parallel safe
set search_path to 'public', 'pg_temp'
as $function$
declare
  base_group text := public.infer_public_filter_group(p_name, p_category_slug);
begin
  if base_group <> 'other' then
    return base_group;
  end if;

  if p_store_slug = any (array['cropp','house','reserved','takko','ca']) then
    return 'fashion';
  end if;

  if p_store_slug = any (array['asko','jysk','ikea','bauhaus','pro-doma','dek','obi']) then
    return 'home';
  end if;

  return base_group;
end;
$function$;

create materialized view private.public_offer_search_cache_v3 as
with joined as materialized (
  select
    o.id as offer_id,
    o.product_id,
    o.store_id,
    coalesce(o.category_id, p.category_id) as category_id,
    o.title,
    o.description,
    o.price,
    o.old_price,
    coalesce(o.image_url, p.image_url) as image_url,
    o.valid_from,
    o.valid_to,
    o.published_at,
    o.updated_at,
    o.coverage_scope,
    o.region_code,
    o.city_name,
    o.store_location_name,
    o.is_verified,
    o.metadata,
    s.name as store_name,
    s.slug as store_slug,
    s.logo_url as store_logo_url,
    s.primary_color as store_primary_color,
    p.name as product_name,
    p.brand as product_brand,
    p.quantity_text as product_quantity_text,
    p.image_url as product_image_url,
    p.filter_tags as product_filter_tags,
    p.content_form as product_content_form,
    p.classification_confidence as product_classification_confidence,
    c.name as category_name,
    c.slug as category_slug,
    coalesce(
      p.filter_group,
      public.resolve_public_filter_group(coalesce(nullif(o.title, ''), p.name, ''), c.slug, s.slug)
    ) as effective_filter_group,
    coalesce(
      o.product_id::text,
      trim(both from regexp_replace(lower(unaccent(coalesce(nullif(o.title, ''), p.name, ''))), '[^a-z0-9]+', ' ', 'g'))
    ) as dedupe_identity,
    normalize_text(concat_ws(' ', o.title, p.name, p.brand, c.name, s.name)) as normalized_search,
    normalize_text(concat_ws(' ', o.title, p.name, p.brand)) as normalized_product_search,
    public_offer_semantic_tags(concat_ws(' ', o.title, p.name, p.brand)) as semantic_tags
  from public.offers o
  join public.stores s on s.id = o.store_id and s.is_active is true
  left join public.products p on p.id = o.product_id
  left join public.categories c on c.id = coalesce(o.category_id, p.category_id)
  where o.status = 'published' and o.is_verified is true
), ranked as (
  select
    j.*,
    row_number() over (
      partition by
        j.store_slug,
        j.dedupe_identity,
        j.price,
        j.valid_from,
        j.valid_to,
        coalesce(j.coverage_scope, 'national'),
        coalesce(j.region_code, ''),
        coalesce(j.city_name, ''),
        coalesce(j.store_location_name, '')
      order by
        (j.image_url is not null) desc,
        j.published_at desc nulls last,
        j.updated_at desc nulls last,
        j.offer_id
    ) as dedupe_rank
  from joined j
)
select
  offer_id,
  product_id,
  store_id,
  category_id,
  title,
  description,
  price,
  old_price,
  image_url,
  valid_from,
  valid_to,
  published_at,
  coverage_scope,
  region_code,
  city_name,
  store_location_name,
  is_verified,
  metadata,
  store_name,
  store_slug,
  store_logo_url,
  store_primary_color,
  product_name,
  product_brand,
  product_quantity_text,
  product_image_url,
  product_filter_tags,
  product_content_form,
  product_classification_confidence,
  category_name,
  category_slug,
  effective_filter_group,
  normalized_search,
  normalized_product_search,
  semantic_tags
from ranked
where dedupe_rank = 1;

create unique index public_offer_search_cache_v3_offer_id_uidx on private.public_offer_search_cache_v3 (offer_id);
create index public_offer_search_cache_v3_group_idx on private.public_offer_search_cache_v3 (effective_filter_group, valid_to, valid_from);
create index public_offer_search_cache_v3_price_idx on private.public_offer_search_cache_v3 (price);
create index public_offer_search_cache_v3_product_search_trgm_idx on private.public_offer_search_cache_v3 using gin (normalized_product_search gin_trgm_ops);
create index public_offer_search_cache_v3_published_idx on private.public_offer_search_cache_v3 (published_at desc);
create index public_offer_search_cache_v3_region_idx on private.public_offer_search_cache_v3 (region_code, city_name);
create index public_offer_search_cache_v3_search_trgm_idx on private.public_offer_search_cache_v3 using gin (normalized_search gin_trgm_ops);
create index public_offer_search_cache_v3_semantic_tags_gin_idx on private.public_offer_search_cache_v3 using gin (semantic_tags);
create index public_offer_search_cache_v3_store_idx on private.public_offer_search_cache_v3 (store_slug, valid_to, valid_from);
create index public_offer_search_cache_v3_validity_idx on private.public_offer_search_cache_v3 (valid_to, valid_from);

grant select on private.public_offer_search_cache_v3 to anon, authenticated, service_role;

do $verify$
declare
  old_rows bigint;
  new_rows bigint;
  unexpected_other bigint;
begin
  select count(*) into old_rows from private.public_offer_search_cache;
  select count(*) into new_rows from private.public_offer_search_cache_v3;
  if new_rows <> old_rows then
    raise exception 'store-family cache rebuild changed row count: old %, new %', old_rows, new_rows;
  end if;

  select count(*) into unexpected_other
  from private.public_offer_search_cache_v3
  where effective_filter_group = 'other'
    and store_slug = any(array['cropp','house','reserved','takko','ca','asko','jysk','ikea','bauhaus','pro-doma','dek','obi']);
  if unexpected_other <> 0 then
    raise exception 'store-family fallback left % unexpected other rows', unexpected_other;
  end if;
end;
$verify$;

alter materialized view private.public_offer_search_cache rename to public_offer_search_cache_pre_store_fallback;
alter materialized view private.public_offer_search_cache_v3 rename to public_offer_search_cache;
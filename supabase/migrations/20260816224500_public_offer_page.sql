create or replace function public.get_public_offer_page(
  p_limit integer default 24,
  p_offset integer default 0,
  p_include_upcoming boolean default true
)
returns table(
  offer jsonb,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select
      greatest(1, least(coalesce(p_limit, 24), 100)) as row_limit,
      greatest(coalesce(p_offset, 0), 0) as row_offset,
      (timezone('Europe/Prague', now()))::date as today
  ),
  ranked as (
    select
      o.*,
      s.name as store_name,
      s.slug as store_slug,
      s.logo_url as store_logo_url,
      s.primary_color as store_primary_color,
      p.name as product_name,
      p.brand as product_brand,
      p.quantity_text as product_quantity_text,
      p.image_url as product_image_url,
      p.filter_group as product_filter_group,
      p.filter_tags as product_filter_tags,
      p.content_form as product_content_form,
      p.classification_confidence as product_classification_confidence,
      c.name as category_name,
      c.slug as category_slug,
      row_number() over (
        partition by
          s.slug,
          trim(regexp_replace(
            regexp_replace(
              lower(public.unaccent(coalesce(nullif(o.title, ''), p.name, ''))),
              '\m[0-9]+([.,][0-9]+)?[[:space:]]*(g|kg|ml|l|ks|bal|baleni)\M',
              '',
              'gi'
            ),
            '[^a-z0-9]+',
            ' ',
            'g'
          )),
          o.valid_from,
          o.valid_to
        order by
          (coalesce(o.image_url, p.image_url) is not null) desc,
          o.published_at desc nulls last,
          o.updated_at desc nulls last,
          o.id
      ) as dedupe_rank
    from public.offers o
    join public.stores s on s.id = o.store_id and s.is_active is true
    left join public.products p on p.id = o.product_id
    left join public.categories c on c.id = coalesce(o.category_id, p.category_id)
    cross join params x
    where o.status = 'published'
      and o.is_verified is true
      and o.valid_to >= x.today
      and o.valid_from <= case when p_include_upcoming then x.today + 7 else x.today end
  ),
  dedup as (
    select * from ranked where dedupe_rank = 1
  ),
  counted as (
    select d.*, count(*) over ()::bigint as total_count
    from dedup d
  )
  select
    jsonb_build_object(
      'id', id,
      'product_id', product_id,
      'store_id', store_id,
      'category_id', category_id,
      'title', title,
      'description', description,
      'price', price,
      'old_price', old_price,
      'image_url', coalesce(image_url, product_image_url),
      'valid_from', valid_from,
      'valid_to', valid_to,
      'published_at', published_at,
      'coverage_scope', coverage_scope,
      'region_code', region_code,
      'city_name', city_name,
      'store_location_name', store_location_name,
      'is_verified', is_verified,
      'metadata', metadata,
      'stores', jsonb_build_object(
        'name', store_name,
        'slug', store_slug,
        'logo_url', store_logo_url,
        'primary_color', store_primary_color
      ),
      'products', jsonb_build_object(
        'name', product_name,
        'brand', product_brand,
        'quantity_text', product_quantity_text,
        'image_url', product_image_url,
        'filter_group', product_filter_group,
        'filter_tags', product_filter_tags,
        'content_form', product_content_form,
        'classification_confidence', product_classification_confidence
      ),
      'categories', case when category_name is null then null else jsonb_build_object(
        'name', category_name,
        'slug', category_slug
      ) end
    ) as offer,
    total_count
  from counted, params
  order by
    (valid_from > params.today) asc,
    coalesce(discount_percent, 0) desc,
    coalesce(deal_score, 0) desc,
    published_at desc nulls last,
    id
  limit (select row_limit from params)
  offset (select row_offset from params);
$$;

revoke all on function public.get_public_offer_page(integer, integer, boolean) from public;
grant execute on function public.get_public_offer_page(integer, integer, boolean) to anon, authenticated, service_role;

comment on function public.get_public_offer_page(integer, integer, boolean) is
  'Paginated, deduplicated public offer feed. Returns frontend-compatible JSON rows and authoritative total_count without downloading the full offer pool.';

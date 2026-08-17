create or replace function public.get_public_offer_page(
  p_limit integer default 24,
  p_offset integer default 0,
  p_include_upcoming boolean default true
)
returns table(offer jsonb, total_count bigint)
language sql
stable
security invoker
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $function$
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
      row_number() over (
        partition by
          s.slug,
          trim(regexp_replace(
            regexp_replace(
              lower(public.unaccent(o.title)),
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
          (o.image_url is not null) desc,
          o.published_at desc nulls last,
          o.updated_at desc nulls last,
          o.id
      ) as dedupe_rank
    from public.offers o
    join public.stores s on s.id = o.store_id and s.is_active is true
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
    select d.*, count(*) over ()::bigint as result_count
    from dedup d
  ),
  page as (
    select c.*
    from counted c, params
    order by
      (c.valid_from > params.today) asc,
      coalesce(c.discount_percent, 0) desc,
      coalesce(c.deal_score, 0) desc,
      c.published_at desc nulls last,
      c.id
    limit (select row_limit from params)
    offset (select row_offset from params)
  )
  select
    jsonb_build_object(
      'id', pg.id,
      'product_id', pg.product_id,
      'store_id', pg.store_id,
      'category_id', pg.category_id,
      'title', pg.title,
      'description', pg.description,
      'price', pg.price,
      'old_price', pg.old_price,
      'image_url', coalesce(pg.image_url, p.image_url),
      'valid_from', pg.valid_from,
      'valid_to', pg.valid_to,
      'published_at', pg.published_at,
      'coverage_scope', pg.coverage_scope,
      'region_code', pg.region_code,
      'city_name', pg.city_name,
      'store_location_name', pg.store_location_name,
      'is_verified', pg.is_verified,
      'metadata', pg.metadata,
      'stores', jsonb_build_object(
        'name', pg.store_name,
        'slug', pg.store_slug,
        'logo_url', pg.store_logo_url,
        'primary_color', pg.store_primary_color
      ),
      'products', jsonb_build_object(
        'name', p.name,
        'brand', p.brand,
        'quantity_text', p.quantity_text,
        'image_url', p.image_url,
        'filter_group', p.filter_group,
        'filter_tags', p.filter_tags,
        'content_form', p.content_form,
        'classification_confidence', p.classification_confidence
      ),
      'categories', case when c.name is null then null else jsonb_build_object(
        'name', c.name,
        'slug', c.slug
      ) end
    ) as offer,
    pg.result_count as total_count
  from page pg
  left join public.products p on p.id = pg.product_id
  left join public.categories c on c.id = coalesce(pg.category_id, p.category_id)
  order by
    (pg.valid_from > (timezone('Europe/Prague', now()))::date) asc,
    coalesce(pg.discount_percent, 0) desc,
    coalesce(pg.deal_score, 0) desc,
    pg.published_at desc nulls last,
    pg.id;
$function$;

grant execute on function public.get_public_offer_page(integer,integer,boolean) to anon, authenticated, service_role;

create or replace function public.get_public_product_price_history(
  p_product_id uuid,
  p_limit integer default 1000
)
returns table(
  id bigint,
  product_id uuid,
  store_id uuid,
  branch_id uuid,
  offer_id uuid,
  price numeric,
  old_price numeric,
  unit_price numeric,
  recorded_at timestamptz,
  valid_from date,
  valid_to date,
  source_url text,
  store_name text,
  store_slug text,
  store_logo_url text
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  with base as materialized (
    select ph.*
    from public.price_history ph
    where ph.product_id = p_product_id
      and ph.price is not null
      and ph.price > 0
  ),
  ambiguous as materialized (
    select b.store_id, b.branch_id, b.recorded_at
    from base b
    group by b.store_id, b.branch_id, b.recorded_at
    having count(distinct b.price) > 1
  ),
  safe_latest as materialized (
    select b.*
    from base b
    where not exists (
      select 1
      from ambiguous a
      where a.store_id is not distinct from b.store_id
        and a.branch_id is not distinct from b.branch_id
        and a.recorded_at = b.recorded_at
    )
    order by b.recorded_at desc, b.id desc
    limit greatest(1, least(coalesce(p_limit, 1000), 2000))
  )
  select
    h.id,
    h.product_id,
    h.store_id,
    h.branch_id,
    h.offer_id,
    h.price,
    h.old_price,
    h.unit_price,
    h.recorded_at,
    h.valid_from,
    h.valid_to,
    h.source_url,
    s.name as store_name,
    s.slug as store_slug,
    s.logo_url as store_logo_url
  from safe_latest h
  left join public.stores s on s.id = h.store_id
  order by h.recorded_at asc, h.id asc;
$function$;

revoke all on function public.get_public_product_price_history(uuid, integer) from public;
grant execute on function public.get_public_product_price_history(uuid, integer) to anon, authenticated, service_role;

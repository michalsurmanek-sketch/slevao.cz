create or replace function public.get_public_offer_metrics()
returns table(
  current_displayable bigint,
  upcoming_displayable bigint,
  frontend_window_displayable bigint,
  current_verified_raw bigint,
  upcoming_verified_raw bigint,
  frontend_window_raw bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with eligible as (
    select
      o.id,
      o.valid_from,
      o.valid_to,
      s.slug,
      trim(regexp_replace(
        regexp_replace(
          lower(public.unaccent(coalesce(nullif(o.title, ''), p.name, ''))),
          '\m[0-9]+([.,][0-9]+)?[[:space:]]*(g|kg|ml|l|ks|bal|baleni)\M',
          '',
          'g'
        ),
        '[^a-z0-9]+',
        ' ',
        'g'
      )) as normalized_title
    from public.offers o
    join public.stores s on s.id = o.store_id and s.is_active is true
    left join public.products p on p.id = o.product_id
    where o.status = 'published'
      and o.is_verified is true
      and o.valid_to >= current_date
      and o.valid_from <= current_date + 7
  ),
  dedup as (
    select distinct on (slug, normalized_title, valid_from, valid_to)
      id, valid_from, valid_to, slug, normalized_title
    from eligible
    order by slug, normalized_title, valid_from, valid_to, id
  )
  select
    count(*) filter (where d.valid_from <= current_date)::bigint as current_displayable,
    count(*) filter (where d.valid_from > current_date)::bigint as upcoming_displayable,
    count(*)::bigint as frontend_window_displayable,
    (select count(*) from eligible e where e.valid_from <= current_date)::bigint as current_verified_raw,
    (select count(*) from eligible e where e.valid_from > current_date)::bigint as upcoming_verified_raw,
    (select count(*) from eligible)::bigint as frontend_window_raw
  from dedup d;
$$;

revoke all on function public.get_public_offer_metrics() from public;
grant execute on function public.get_public_offer_metrics() to anon, authenticated, service_role;

comment on function public.get_public_offer_metrics() is
  'Authoritative public offer counts matching the homepage eligibility window and dedupe identity. current_displayable excludes upcoming offers.';

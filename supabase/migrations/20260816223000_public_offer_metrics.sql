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
    where o.status = 'published'
      and o.is_verified is true
      and o.valid_from <= (timezone('Europe/Prague', now()))::date + 7
      and o.valid_to >= (timezone('Europe/Prague', now()))::date
  )
  select
    count(*) filter (
      where dedupe_rank = 1
        and valid_from <= (timezone('Europe/Prague', now()))::date
    )::bigint as current_displayable,
    count(*) filter (
      where dedupe_rank = 1
        and valid_from > (timezone('Europe/Prague', now()))::date
    )::bigint as upcoming_displayable,
    count(*) filter (where dedupe_rank = 1)::bigint as frontend_window_displayable,
    count(*) filter (
      where valid_from <= (timezone('Europe/Prague', now()))::date
    )::bigint as current_verified_raw,
    count(*) filter (
      where valid_from > (timezone('Europe/Prague', now()))::date
    )::bigint as upcoming_verified_raw,
    count(*)::bigint as frontend_window_raw
  from eligible;
$$;

revoke all on function public.get_public_offer_metrics() from public;
grant execute on function public.get_public_offer_metrics() to anon, authenticated, service_role;

comment on function public.get_public_offer_metrics() is
  'Authoritative public offer counts matching homepage eligibility, Prague date boundaries and frontend dedupe identity.';

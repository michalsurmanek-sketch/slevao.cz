-- Odstraní přesné duplicity nabídek a zabrání jejich opětovnému vzniku.
-- Stejný produkt v jiném období, regionu nebo prodejně zůstává zachovaný.

with ranked_offers as (
  select
    id,
    row_number() over (
      partition by
        store_id,
        lower(btrim(title)),
        valid_from,
        valid_to,
        coverage_scope,
        coalesce(region_code, ''),
        coalesce(city_name, ''),
        coalesce(store_location_name, '')
      order by
        (image_url is not null) desc,
        is_verified desc,
        published_at desc nulls last,
        id
    ) as duplicate_rank
  from public.offers
)
delete from public.offers o
using ranked_offers r
where o.id = r.id
  and r.duplicate_rank > 1;

create unique index if not exists offers_import_identity_uidx
  on public.offers (
    store_id,
    lower(btrim(title)),
    valid_from,
    valid_to,
    coverage_scope,
    coalesce(region_code, ''),
    coalesce(city_name, ''),
    coalesce(store_location_name, '')
  );

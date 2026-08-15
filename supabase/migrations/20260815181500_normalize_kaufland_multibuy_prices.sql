-- Convert Kaufland multibuy totals to the advertised per-item price.
with parsed as (
  select
    o.id,
    o.price,
    o.old_price,
    ((m)[1])::numeric as item_count,
    replace((m)[3], ',', '.')::numeric as item_price
  from public.offers o
  cross join lateral regexp_match(
    lower(coalesce(o.description, '')),
    'při[[:space:]]+koupi[[:space:]]+([0-9]+)[[:space:]]+kus(ů|u)?[^0-9]*za[[:space:]]+1[[:space:]]+kus[[:space:]]+([0-9]+([.,][0-9]+)?)[[:space:]]*kč'
  ) as m
  where o.metadata ->> 'adapter' = 'kaufland-products-v4-ssr'
)
update public.offers o
set
  price = p.item_price,
  old_price = case
    when p.old_price is not null and p.old_price > p.item_price
      then round(p.old_price / p.item_count, 2)
    else p.old_price
  end,
  updated_at = now()
from parsed p
where o.id = p.id
  and p.item_count > 1
  and p.item_price > 0
  and abs(p.price - (p.item_price * p.item_count)) <= 1;

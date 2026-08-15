-- Remove Kaufland campaign copy and sales-channel text from canonical product titles.
with cleaned as (
  select
    p.id,
    btrim(
      regexp_replace(
        regexp_replace(p.name, '^K-Mistři od fochu[[:space:]]+', '', 'i'),
        '[[:space:]]*,?[[:space:]]*(pultový|samoobslužný)[[:space:]]+prodej[[:space:]]*$',
        '',
        'i'
      )
    ) as clean_name
  from public.products p
  where p.metadata ->> 'kaufland_kl_nr' is not null
    and (
      p.name ~* '^K-Mistři od fochu[[:space:]]+'
      or p.name ~* '[[:space:]](pultový|samoobslužný)[[:space:]]+prodej[[:space:]]*$'
    )
), updated_products as (
  update public.products p
  set
    name = c.clean_name,
    normalized_name = public.normalize_product_name(c.clean_name),
    updated_at = now()
  from cleaned c
  where p.id = c.id
    and c.clean_name <> ''
    and p.name is distinct from c.clean_name
  returning p.id, p.name
)
update public.offers o
set
  title = u.name,
  normalized_title = public.normalize_product_name(u.name),
  updated_at = now()
from updated_products u
where o.product_id = u.id
  and o.metadata ->> 'adapter' = 'kaufland-products-v4-ssr';

update public.leaflet_import_items
set title = btrim(
  regexp_replace(
    regexp_replace(title, '^K-Mistři od fochu[[:space:]]+', '', 'i'),
    '[[:space:]]*,?[[:space:]]*(pultový|samoobslužný)[[:space:]]+prodej(?=[[:space:]]*·|[[:space:]]*$)',
    '',
    'i'
  )
)
where raw_data ->> 'adapter' = 'kaufland-products-v4-ssr'
  and (
    title ~* '^K-Mistři od fochu[[:space:]]+'
    or title ~* '[[:space:]](pultový|samoobslužný)[[:space:]]+prodej'
  );

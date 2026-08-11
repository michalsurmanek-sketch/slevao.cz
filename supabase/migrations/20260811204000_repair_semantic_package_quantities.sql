-- Product quantity must describe the sold package, not an active ingredient
-- concentration or a device capacity.

-- BENU: medicine names often contain dosage first and the actual sold package
-- at the end (30G, 120ML, 20 tablets, ...).
with benu as (
  select distinct on (p.id)
    p.id,
    o.title,
    case
      when o.title ~* '(tableta|tablety|tablet|pastilka|pastilky)[^0-9]*[0-9]+\s*$'
        then (regexp_match(o.title, '([0-9]+)\s*$'))[1] || ' ks'
      when o.title ~* '[0-9]+(?:[,.][0-9]+)?\s*(ml|g)\s*(?:\+[^ ]+)?\s*$'
        then public.product_quantity_key(o.title)
      else null
    end as package_quantity
  from public.products p
  join public.offers o on o.product_id = p.id
  join public.stores s on s.id = o.store_id
  where s.slug = 'benu'
    and o.status = 'published'
    and o.valid_to >= (now() at time zone 'Europe/Prague')::date
    and coalesce(p.quantity_text, '') ~* 'mg'
  order by p.id, o.valid_to desc, o.valid_from desc
)
update public.products p
set quantity_text = b.package_quantity,
    metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object(
      '_semantic_package_repaired_at', now(),
      '_semantic_package_repair_source', 'benu_title_package'
    ),
    updated_at = now()
from benu b
where p.id = b.id and b.package_quantity is not null;

-- Explicit trailing piece count is stronger package information than a
-- capacity mentioned earlier in the title (for example a 40 kg luggage scale,
-- sold as 1 piece). Also fill missing piece quantities.
with pieces as (
  select
    p.id,
    (regexp_match(p.name, ',\s*([0-9]+)\s*ks\s*$', 'i'))[1] || ' ks' as package_quantity
  from public.products p
  where p.is_active = true
    and p.name ~* ',\s*[0-9]+\s*ks\s*$'
    and public.product_quantity_key(p.quantity_text) is distinct from public.product_quantity_key(p.name)
)
update public.products p
set quantity_text = x.package_quantity,
    metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object(
      '_semantic_package_repaired_at', now(),
      '_semantic_package_repair_source', 'explicit_trailing_piece_count'
    ),
    updated_at = now()
from pieces x
where p.id = x.id and x.package_quantity is not null;

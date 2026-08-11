-- Canonical package identity: compare equivalent package sizes in base units
-- (2x900 ml = 1.8 l, 4x50 g = 200 g) and avoid reading shade codes such
-- as "010 Gloss" as "010 g". For titles containing medical dosage plus a
-- package, the final/multipack quantity wins.
create or replace function public.product_quantity_key(value text)
returns text
language plpgsql
immutable
parallel safe
set search_path to 'public', 'pg_temp'
as $function$
declare
  source_text text := lower(unaccent(coalesce(value, '')));
  parts text[];
  last_parts text[];
  amount numeric;
  multiplier numeric;
  unit_key text;
  total numeric;
begin
  -- Prefer explicit multipacks anywhere in the text.
  for parts in
    select regexp_matches(
      source_text,
      '([0-9]+)\s*[x×]\s*([0-9]+(?:[.,][0-9]+)?)\s*(kg|mg|g|ml|cl|l|ks|kus|kusy|kusu|davka|davky|davek|role|roli|rol|baleni)([^[:alpha:]]|$)',
      'g'
    )
  loop
    last_parts := parts;
  end loop;

  if last_parts is not null then
    multiplier := replace(last_parts[1], ',', '.')::numeric;
    amount := replace(last_parts[2], ',', '.')::numeric;
    unit_key := last_parts[3];

    if unit_key = 'kg' then total := multiplier * amount * 1000; return trim_scale(total)::text || 'g'; end if;
    if unit_key = 'mg' then total := multiplier * amount / 1000; return trim_scale(total)::text || 'g'; end if;
    if unit_key = 'g' then total := multiplier * amount; return trim_scale(total)::text || 'g'; end if;
    if unit_key = 'l' then total := multiplier * amount * 1000; return trim_scale(total)::text || 'ml'; end if;
    if unit_key = 'cl' then total := multiplier * amount * 10; return trim_scale(total)::text || 'ml'; end if;
    if unit_key = 'ml' then total := multiplier * amount; return trim_scale(total)::text || 'ml'; end if;

    unit_key := case unit_key
      when 'kus' then 'ks' when 'kusy' then 'ks' when 'kusu' then 'ks'
      when 'davky' then 'davka' when 'davek' then 'davka'
      when 'roli' then 'role' when 'rol' then 'role'
      when 'baleni' then 'bal'
      else unit_key
    end;
    return trim_scale(multiplier * amount)::text || unit_key;
  end if;

  -- Otherwise use the last standalone package-like quantity. The unit must end
  -- at a non-letter boundary, so cosmetic shade names cannot masquerade as g/l/cl.
  last_parts := null;
  for parts in
    select regexp_matches(
      source_text,
      '([0-9]+(?:[.,][0-9]+)?)\s*(kg|mg|g|ml|cl|l|ks|kus|kusy|kusu|davka|davky|davek|role|roli|rol|baleni)([^[:alpha:]]|$)',
      'g'
    )
  loop
    last_parts := parts;
  end loop;

  if last_parts is null then return null; end if;

  amount := replace(last_parts[1], ',', '.')::numeric;
  unit_key := last_parts[2];
  if unit_key = 'kg' then return trim_scale(amount * 1000)::text || 'g'; end if;
  if unit_key = 'mg' then return trim_scale(amount / 1000)::text || 'g'; end if;
  if unit_key = 'g' then return trim_scale(amount)::text || 'g'; end if;
  if unit_key = 'l' then return trim_scale(amount * 1000)::text || 'ml'; end if;
  if unit_key = 'cl' then return trim_scale(amount * 10)::text || 'ml'; end if;
  if unit_key = 'ml' then return trim_scale(amount)::text || 'ml'; end if;

  unit_key := case unit_key
    when 'kus' then 'ks' when 'kusy' then 'ks' when 'kusu' then 'ks'
    when 'davky' then 'davka' when 'davek' then 'davka'
    when 'roli' then 'role' when 'rol' then 'role'
    when 'baleni' then 'bal'
    else unit_key
  end;
  return trim_scale(amount)::text || unit_key;
end;
$function$;

-- Repair BENU products where the historical parser saved drug concentration
-- (mg/ml) as the package quantity even though the title contains 1xNN ml/g.
with benu_products as (
  select distinct p.id, public.product_quantity_key(o.title) as package_key
  from public.products p
  join public.offers o on o.product_id = p.id
  join public.stores s on s.id = o.store_id
  where s.slug = 'benu'
    and o.status = 'published'
    and o.valid_to >= (now() at time zone 'Europe/Prague')::date
    and o.title ~* '[0-9]+\s*[x×]\s*[0-9]+(?:[,.][0-9]+)?\s*(ml|g)([^[:alpha:]]|$)'
    and coalesce(p.quantity_text, '') ~* 'mg'
)
update public.products p
set quantity_text = bp.package_key,
    metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object('_package_quantity_repaired_at', now(), '_package_quantity_repair_source', 'title_multipack'),
    updated_at = now()
from benu_products bp
where p.id = bp.id and bp.package_key is not null;

-- Repair old decimal-comma parsing artefacts such as 0,5 l -> 5l / 1,00 kg -> 00kg.
with repair as (
  select distinct on (p.id)
    p.id,
    o.title,
    public.product_quantity_key(o.title) as package_key
  from public.products p
  join public.offers o on o.product_id = p.id
  join public.stores s on s.id = o.store_id
  where s.slug in ('billa','globus')
    and o.status = 'published'
    and o.valid_to >= (now() at time zone 'Europe/Prague')::date
    and (
      coalesce(p.quantity_text, '') ~ '^(?:[0-9]+)?00(?:kg|g|l|ml)$'
      or (o.title ~* '0,5\s*l' and public.product_quantity_key(coalesce(p.quantity_text,p.name)) <> '500ml')
    )
  order by p.id, o.valid_to desc, o.valid_from desc
)
update public.products p
set quantity_text = r.package_key,
    metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object('_package_quantity_repaired_at', now(), '_package_quantity_repair_source', 'decimal_comma_title'),
    updated_at = now()
from repair r
where p.id = r.id and r.package_key is not null;

create or replace function public.sanitize_lidl_verified_title(p_title text)
returns text
language sql
immutable parallel safe
set search_path to 'public', 'pg_temp'
as $function$
  with step0 as (
    select btrim(regexp_replace(
      coalesce(p_title,''),
      '^\\*?\\s*úspora\\s+na\\s+měrné\\s+ceně\\s+v\\s+porovnání\\s+s\\s+produktem\\s+ve\\s+standardně\\s+nabízené\\s+velikosti\\s+',
      '',
      'i'
    )) as value
  ), step1 as (
    select btrim(regexp_replace(value, '^\\*{0,2}\\s*doporučená prodejní cena výrobce\\s+', '', 'i')) as value
    from step0
  ), step2 as (
    select btrim(regexp_replace(
      value,
      '^Od\\s+(pondělí|úterý|středy|středa|čtvrtka|pátku|pátek|soboty|sobota|neděle)\\s+[0-9]{1,2}\\.\\s*[0-9]{1,2}\\.\\s*do\\s*[0-9]{1,2}\\.\\s*[0-9]{1,2}\\.\\s+',
      '',
      'i'
    )) as value
    from step1
  )
  select case
    when value ~ '^[0-9]+([.,][0-9]+)?([[:space:]]+[0-9]+([.,][0-9]+)?)+$' then ''
    else value
  end
  from step2;
$function$;

update public.leaflet_import_items lii
set title = public.sanitize_lidl_verified_title(
      regexp_replace(lii.title, '\\s*[·•]\\s*([0-9]+(?:[.,][0-9]+)?\\s*(?:g|kg|ml|l|ks))\\s*$', '', 'i')
    ) || case
      when lii.quantity_text is not null and btrim(lii.quantity_text) <> '' then ' · ' || btrim(lii.quantity_text)
      else ''
    end,
    updated_at = now()
from public.leaflet_imports li, public.stores s
where lii.import_id = li.id
  and li.store_id = s.id
  and s.slug = 'lidl'
  and lii.title ~* '^\\*?\\s*úspora\\s+na\\s+měrné\\s+ceně\\s+v\\s+porovnání\\s+s\\s+produktem\\s+ve\\s+standardně\\s+nabízené\\s+velikosti';

update public.offers o
set title = public.sanitize_lidl_verified_title(o.title)
from public.stores s
where o.store_id = s.id
  and s.slug = 'lidl'
  and o.title ~* '^\\*?\\s*úspora\\s+na\\s+měrné\\s+ceně\\s+v\\s+porovnání\\s+s\\s+produktem\\s+ve\\s+standardně\\s+nabízené\\s+velikosti';

update public.products p
set name = public.sanitize_lidl_verified_title(p.name),
    normalized_name = public.normalize_text(public.sanitize_lidl_verified_title(p.name)),
    updated_at = now()
where p.name ~* '^\\*?\\s*úspora\\s+na\\s+měrné\\s+ceně\\s+v\\s+porovnání\\s+s\\s+produktem\\s+ve\\s+standardně\\s+nabízené\\s+velikosti'
  and exists (
    select 1 from public.offers o join public.stores s on s.id=o.store_id
    where o.product_id=p.id and s.slug='lidl'
  )
  and not exists (
    select 1 from public.offers o join public.stores s on s.id=o.store_id
    where o.product_id=p.id and s.slug<>'lidl'
  );
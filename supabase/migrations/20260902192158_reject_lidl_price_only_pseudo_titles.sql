create or replace function public.sanitize_lidl_verified_title(p_title text)
returns text
language sql
immutable parallel safe
set search_path to 'public','pg_temp'
as $function$
  with step0 as (
    select btrim(regexp_replace(
      coalesce(p_title,''),
      E'^\\*?\\s*úspora\\s+na\\s+měrné\\s+ceně\\s+v\\s+porovnání\\s+s\\s+produktem\\s+ve\\s+standardně\\s+nabízené\\s+velikosti\\s+',
      '',
      'i'
    )) as value
  ), step1 as (
    select btrim(regexp_replace(value, E'^\\*{0,2}\\s*doporučená prodejní cena výrobce\\s+', '', 'i')) as value
    from step0
  ), step2 as (
    select btrim(regexp_replace(
      value,
      E'^Od\\s+(pondělí|úterý|středy|středa|čtvrtka|pátku|pátek|soboty|sobota|neděle)\\s+[0-9]{1,2}\\.\\s*[0-9]{1,2}\\.\\s*do\\s*[0-9]{1,2}\\.\\s*[0-9]{1,2}\\.\\s+',
      '',
      'i'
    )) as value
    from step1
  )
  select case
    when value ~ E'^[0-9]+([.,][0-9]+)?([[:space:]]+[0-9]+([.,][0-9]+)?)+$' then ''
    when value ~ E'^[0-9]{1,4}[.,][0-9]{1,2}$' then ''
    when value ~ E'^[-–]?\\s*[0-9]{1,3}%\\s+[0-9]{1,4}[.,][0-9]{1,2}$' then ''
    when value ~ E'^[0-9]{1,4}[.,]-$' then ''
    else value
  end
  from step2;
$function$;

update public.offers o
set status='expired', updated_at=now()
from public.stores s
where s.id=o.store_id
  and s.slug='lidl'
  and o.status='published'
  and coalesce(o.metadata->>'adapter','')='lidl-verified-pdf-text-v2'
  and (
    btrim(o.title) ~ E'^[0-9]{1,4}[.,][0-9]{1,2}$'
    or btrim(o.title) ~ E'^[-–]?\\s*[0-9]{1,3}%\\s+[0-9]{1,4}[.,][0-9]{1,2}$'
    or btrim(o.title) ~ E'^[0-9]{1,4}[.,]-$'
  );

update public.products p
set is_active=false, updated_at=now()
where p.id in (
  select p2.id
  from public.products p2
  where (
    btrim(p2.name) ~ E'^[0-9]{1,4}[.,][0-9]{1,2}$'
    or btrim(p2.name) ~ E'^[-–]?\\s*[0-9]{1,3}%\\s+[0-9]{1,4}[.,][0-9]{1,2}$'
    or btrim(p2.name) ~ E'^[0-9]{1,4}[.,]-$'
  )
  and exists (
    select 1 from public.offers o join public.stores s on s.id=o.store_id
    where o.product_id=p2.id and s.slug='lidl'
  )
  and not exists (
    select 1 from public.offers o2
    where o2.product_id=p2.id and o2.status='published'
  )
);

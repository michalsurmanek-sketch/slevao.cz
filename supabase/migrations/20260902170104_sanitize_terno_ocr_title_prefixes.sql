create or replace function public.sanitize_terno_ocr_title(p_title text)
returns text
language sql
immutable parallel safe
set search_path to 'pg_catalog', 'public'
as $function$
  with step1 as (
    select btrim(regexp_replace(coalesce(p_title,''), E'^[\\\\/|*]+\\s*', '', 'g')) as value
  ), step2 as (
    select btrim(regexp_replace(value, E'^CENA\\s+', '', 'i')) as value
    from step1
  )
  select value from step2;
$function$;

create or replace function public.sanitize_terno_ocr_import_item_title()
returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if coalesce(new.raw_data->>'parser','') = 'terno-ocr-spatial-unit-price-v5' then
    new.title := public.sanitize_terno_ocr_title(new.title);
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_sanitize_terno_ocr_import_item_title on public.leaflet_import_items;
create trigger trg_sanitize_terno_ocr_import_item_title
before insert or update of title, raw_data on public.leaflet_import_items
for each row
execute function public.sanitize_terno_ocr_import_item_title();

update public.leaflet_import_items
set title = public.sanitize_terno_ocr_title(title),
    updated_at = now()
where coalesce(raw_data->>'parser','') = 'terno-ocr-spatial-unit-price-v5'
  and title is distinct from public.sanitize_terno_ocr_title(title);

update public.offers o
set title = public.sanitize_terno_ocr_title(o.title)
from public.stores s
where o.store_id=s.id
  and s.slug='terno'
  and o.title is distinct from public.sanitize_terno_ocr_title(o.title)
  and coalesce(o.metadata->>'import_id','') in (
    select li.id::text
    from public.leaflet_imports li
    where li.store_id=s.id
      and coalesce(li.metadata->>'parser','')='terno-ocr-spatial-unit-price-v5'
  );

update public.products p
set name = public.sanitize_terno_ocr_title(p.name),
    normalized_name = public.normalize_text(public.sanitize_terno_ocr_title(p.name)),
    updated_at = now()
where p.name is distinct from public.sanitize_terno_ocr_title(p.name)
  and exists (
    select 1 from public.offers o join public.stores s on s.id=o.store_id
    where o.product_id=p.id and s.slug='terno'
  )
  and not exists (
    select 1 from public.offers o join public.stores s on s.id=o.store_id
    where o.product_id=p.id and s.slug<>'terno'
  );
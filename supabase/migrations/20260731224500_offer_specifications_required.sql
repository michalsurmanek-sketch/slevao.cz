-- Přesné specifikace nabídek: gramáž, objem, počet kusů nebo jednotková cena.

create or replace function public.slevao_has_specification(value text)
returns boolean
language sql
immutable
as $$
  select coalesce(value, '') ~* '(^|[^[:alnum:]])([0-9]+([,.][0-9]+)?\s*(mg|g|kg|ml|cl|dl|l|ks|bal|balení|m|cm|mm|m2|m²|m3|m³|%))([^[:alnum:]]|$)';
$$;

create or replace function public.slevao_offer_display_title(
  base_title text,
  quantity_value text,
  unit_value text
)
returns text
language plpgsql
immutable
as $$
declare
  title_clean text := btrim(coalesce(base_title, ''));
  quantity_clean text := btrim(coalesce(quantity_value, ''));
  unit_clean text := btrim(coalesce(unit_value, ''));
  detail text := '';
begin
  if title_clean = '' then
    return title_clean;
  end if;

  if public.slevao_has_specification(title_clean) then
    return title_clean;
  end if;

  if quantity_clean <> '' then
    detail := quantity_clean;
  elsif unit_clean <> '' then
    detail := case
      when unit_clean ~* '^\s*(za|/)' then unit_clean
      else 'cena za ' || unit_clean
    end;
  end if;

  if detail = '' then
    return title_clean;
  end if;

  return title_clean || ' · ' || detail;
end;
$$;

create or replace function public.slevao_enrich_leaflet_item_specification()
returns trigger
language plpgsql
as $$
begin
  new.title := public.slevao_offer_display_title(new.title, new.quantity_text, new.unit_label);

  if not public.slevao_has_specification(new.title)
     and nullif(btrim(coalesce(new.quantity_text, '')), '') is null
     and nullif(btrim(coalesce(new.unit_label, '')), '') is null then
    new.raw_data := coalesce(new.raw_data, '{}'::jsonb) || jsonb_build_object(
      'missing_specification', true,
      'specification_review_reason', 'Chybí gramáž, objem, počet kusů, rozměr nebo prodejní jednotka.'
    );
    new.confidence := least(coalesce(new.confidence, 1), 0.69);
    if new.status = 'approved' then
      new.status := 'review';
    end if;
  else
    new.raw_data := coalesce(new.raw_data, '{}'::jsonb) - 'missing_specification' - 'specification_review_reason';
  end if;

  return new;
end;
$$;

drop trigger if exists leaflet_item_specification_before_write on public.leaflet_import_items;
create trigger leaflet_item_specification_before_write
before insert or update of title, quantity_text, unit_label, status
on public.leaflet_import_items
for each row
execute function public.slevao_enrich_leaflet_item_specification();

-- Oprav už existující importované položky. Trigger doplní specifikaci do názvu.
update public.leaflet_import_items
set title = title,
    updated_at = now()
where title is not null;

-- Přenes doplněné názvy i do již publikovaných nabídek.
update public.offers o
set title = li.title
from public.leaflet_import_items li
join public.leaflet_imports imp on imp.id = li.import_id
where li.status = 'published'
  and li.product_id = o.product_id
  and imp.store_id = o.store_id
  and imp.detected_valid_from = o.valid_from
  and imp.detected_valid_to = o.valid_to
  and li.title is not null
  and btrim(li.title) <> ''
  and o.title is distinct from li.title;

-- Produkty bez jakékoli specifikace zůstanou viditelné, ale nebudou označené jako ověřené.
update public.offers
set is_verified = false
where not public.slevao_has_specification(title)
  and status = 'published';

create or replace function public.sanitize_hruska_coordinate_title(p_title text)
returns text
language plpgsql
immutable
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_title text := regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g');
  v_suffix text := '';
  v_pos integer;
begin
  v_title := btrim(v_title);
  v_pos := strpos(v_title, ' · ');
  if v_pos > 0 then
    v_suffix := substr(v_title, v_pos);
    v_title := substr(v_title, 1, v_pos - 1);
  end if;

  v_title := regexp_replace(v_title, '\s+(NAŠE\s+CENA|NAŠE)\s*$', '', 'i');
  v_title := regexp_replace(v_title, '\s+Nově\s+Hruška\s*$', '', 'i');
  v_title := regexp_replace(v_title, '\s+vybrané\s+druhy(?:\s+\d{1,2})?\s*$', '', 'i');
  v_title := regexp_replace(v_title, '\s+vybrané\s*$', '', 'i');
  v_title := regexp_replace(v_title, '\s+90\s*$', '', 'i');

  -- Printed campaign notes may be adjacent to the product title in the PDF text layer.
  v_title := regexp_replace(v_title, '(^|\s+)Jen\s+ve\s+vybraných\s+prodejnách(\s+|$)', ' ', 'gi');
  v_title := regexp_replace(v_title, '(^|\s+)Nízké\s+Věrnostní\s+Slevové(\s+|$)', ' ', 'gi');

  v_title := regexp_replace(v_title, '\s*\|\s*$', '', 'g');
  v_title := regexp_replace(v_title, '\s+', ' ', 'g');
  v_title := btrim(v_title);

  return v_title || v_suffix;
end;
$function$;

update public.leaflet_import_items lii
set title = public.sanitize_hruska_coordinate_title(lii.title),
    updated_at = now()
from public.leaflet_imports li, public.stores s
where lii.import_id = li.id
  and li.store_id = s.id
  and s.slug = 'hruska'
  and lii.title ~* 'jen ve vybraných prodejnách|nízké věrnostní slevové|věrnostní slevové';

update public.offers o
set title = public.sanitize_hruska_coordinate_title(o.title)
from public.stores s
where o.store_id = s.id
  and s.slug = 'hruska'
  and o.title ~* 'jen ve vybraných prodejnách|nízké věrnostní slevové|věrnostní slevové';

update public.products p
set name = public.sanitize_hruska_coordinate_title(p.name),
    normalized_name = public.normalize_text(public.sanitize_hruska_coordinate_title(p.name)),
    updated_at = now()
where p.name ~* 'jen ve vybraných prodejnách|nízké věrnostní slevové|věrnostní slevové'
  and exists (
    select 1
    from public.offers o
    join public.stores s on s.id = o.store_id
    where o.product_id = p.id
      and s.slug = 'hruska'
  )
  and not exists (
    select 1
    from public.offers o
    join public.stores s on s.id = o.store_id
    where o.product_id = p.id
      and s.slug <> 'hruska'
  );

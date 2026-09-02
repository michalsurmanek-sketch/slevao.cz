create or replace function public.sanitize_hruska_coordinate_title(p_title text)
returns text
language plpgsql
immutable
set search_path to 'pg_catalog','public'
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

  v_title := regexp_replace(v_title, '^\s*[0-9]+\s*dávka\s*=\s*[0-9]+(?:[,.][0-9]+)?\s*Kč\s+', '', 'i');
  v_title := regexp_replace(v_title, '(^|\s+)KLUBOVÁ\s+CENA(\s+|$)', ' ', 'gi');
  v_title := regexp_replace(v_title, '(^|\s+)NOVINKA(\s+|$)', ' ', 'gi');
  v_title := regexp_replace(v_title, '\s+(NAŠE\s+CENA|NAŠE)\s*$', '', 'i');
  v_title := regexp_replace(v_title, '\s+Nově\s+Hruška\s*$', '', 'i');
  v_title := regexp_replace(v_title, '\s+vybrané\s+druhy(?:\s+\d{1,2})?\s*$', '', 'i');
  v_title := regexp_replace(v_title, '\s+vybrané\s*$', '', 'i');
  v_title := regexp_replace(v_title, '\s+90\s*$', '', 'i');
  v_title := regexp_replace(v_title, '(^|\s+)Jen\s+ve\s+vybraných\s+prodejnách(\s+|$)', ' ', 'gi');
  v_title := regexp_replace(v_title, '(^|\s+)Nízké\s+Věrnostní\s+Slevové(\s+|$)', ' ', 'gi');
  v_title := regexp_replace(v_title, '\s*\|\s*$', '', 'g');
  v_title := regexp_replace(v_title, '\s+', ' ', 'g');
  v_title := btrim(v_title);

  return v_title || v_suffix;
end;
$function$;

create or replace function public.infer_product_filter_group_generic_terms_v44(p_name text,p_quantity_text text)
returns text
language plpgsql
stable parallel safe
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(p_name,''));
begin
  if n ~ '(ovoce susene mrazem|pernik)' then return 'food'; end if;
  if n ~ 'hygienicke .*kapesniky' then return 'drugstore'; end if;
  return public.infer_product_filter_group_generic_terms_v42(p_name,p_quantity_text);
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable parallel safe
set search_path to 'public','pg_temp'
as $function$ select 44 $function$;

do $do$
declare
  v_sql text;
begin
  select pg_get_functiondef(p.oid) into v_sql
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='auto_assign_product_filter_group'
  limit 1;
  v_sql := replace(v_sql,'infer_product_filter_group_generic_terms_v42','infer_product_filter_group_generic_terms_v44');
  v_sql := replace(v_sql,'generic-terms-v42','generic-terms-v44');
  execute v_sql;
end
$do$;

update public.leaflet_import_items lii
set title=public.sanitize_hruska_coordinate_title(lii.title), updated_at=now()
where coalesce(lii.raw_data->>'parser','')='hruska-coordinate-v1'
  and lii.title is distinct from public.sanitize_hruska_coordinate_title(lii.title);

update public.offers o
set title=public.sanitize_hruska_coordinate_title(o.title),
    normalized_title=public.normalize_product_name(public.sanitize_hruska_coordinate_title(o.title)),
    updated_at=now()
from public.stores s
where s.id=o.store_id and s.slug='hruska'
  and o.title is distinct from public.sanitize_hruska_coordinate_title(o.title);

update public.products p
set name=public.sanitize_hruska_coordinate_title(p.name),
    normalized_name=public.normalize_product_name(public.sanitize_hruska_coordinate_title(p.name)),
    updated_at=now()
where p.name is distinct from public.sanitize_hruska_coordinate_title(p.name)
  and exists (
    select 1 from public.offers o join public.stores s on s.id=o.store_id
    where o.product_id=p.id and s.slug='hruska'
  )
  and not exists (
    select 1 from public.offers o2 join public.stores s2 on s2.id=o2.store_id
    where o2.product_id=p.id and s2.slug<>'hruska'
  );

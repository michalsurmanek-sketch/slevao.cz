create or replace function public.product_label_is_specific(value text)
returns boolean
language plpgsql
immutable
parallel safe
set search_path to 'public','pg_temp'
as $function$
declare
  normalized_value text := public.normalize_product_name(value);
begin
  if normalized_value = '' or normalized_value ~ '^[0-9]+$' then
    return false;
  end if;

  if normalized_value = any(array[
    'cena','akce','sleva','vybrane druhy','dle nabidky','dle vyberu','s klubem',
    'club','original','mini','selection','cool','novinka','ruzne druhy','vice druhu'
  ]) then
    return false;
  end if;

  if normalized_value ~ '^(ruzne druhy|vice druhu|vybrane druhy|dle nabidky|dle vyberu)( |$)' then
    return false;
  end if;

  return normalized_value ~ '[a-z]{3,}';
end;
$function$;

delete from public.product_aliases
where normalized_alias ~ '^(ruzne druhy|vice druhu|vybrane druhy|dle nabidky|dle vyberu)( |$)'
   or normalized_alias in ('novinka','akce','sleva','s klubem','club','original','mini','selection','cool');

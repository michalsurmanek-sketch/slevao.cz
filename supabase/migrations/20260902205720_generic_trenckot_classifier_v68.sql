create or replace function public.infer_product_filter_group_generic_terms_v66(p_name text,p_quantity_text text)
returns text
language plpgsql
stable parallel safe
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(p_name,''));
  q text := public.normalize_text(coalesce(p_quantity_text,''));
begin
  if n ~ '(^| )trenckot( |$)' then return 'fashion'; end if;
  if n ~ '(^| )kren( |$)' and q ~ '^[0-9]+([,.][0-9]+)? (g|kg)$' then return 'food'; end if;
  return public.infer_product_filter_group_generic_terms_v65(p_name,p_quantity_text);
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer language sql immutable parallel safe
set search_path to 'public','pg_temp'
as $function$ select 68 $function$;

update public.products p
set metadata=coalesce(p.metadata,'{}'::jsonb)
where p.is_active is true
  and coalesce(nullif(btrim(p.filter_group),''),'other')='other'
  and exists (
    select 1 from public.offers o
    where o.product_id=p.id and o.status='published' and o.is_verified=true
      and o.valid_from <= (now() at time zone 'Europe/Prague')::date
      and o.valid_to >= (now() at time zone 'Europe/Prague')::date
  );
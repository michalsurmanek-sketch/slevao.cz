create or replace function public.infer_product_filter_group_source_rules(
  p_name text,
  p_quantity_text text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
stable
parallel safe
set search_path to 'public','pg_temp'
as $function$
declare
  v_group text;
  n text := public.normalize_text(concat_ws(' ',coalesce(p_name,''),coalesce(p_quantity_text,'')));
  v_source_store text := lower(coalesce(p_metadata->>'source_store_slug',''));
begin
  v_group := public.infer_product_filter_group_v23(p_name,p_quantity_text,p_metadata);
  if v_group <> 'other' then return v_group; end if;

  if v_source_store='dek' then
    return 'home';
  end if;

  if v_source_store='ikea' then
    if n ~ '(^| )prihradky na dokumenty( |$)' then return 'school'; end if;
    if n ~ '(^| )(prkenko|hacek|kos s vikem|krabice|vyvrtka|kryt na potraviny|kbelik s vikem|lopatka smetacek|smetacek a lopatka|vesak na rucniky stolicka|risatorp kos|tjusig vesak|doza s vikem)( |$)' then return 'home'; end if;
  end if;

  if v_source_store='bauhaus' then
    if n ~ '(^| )(aku vyzinac|cesac ovoce|sberac ovoce|retezova pila|stipac dreva)( |$)' then return 'garden'; end if;
    if n ~ '(^| )(varna deska|elektricky ohrivac vody)( |$)' then return 'electronics'; end if;
    if n ~ '(^| )(drevena bedna|krocejova izolace|chranic kolen|diamantovych korunek|sada hladitek|prechodovy profil|vyrovnavaci profil|laser grl|michadlo grw|umyvadlova baterie|chemicke wc|okruzni pila|prime schody|gola sada|elektrocentrala|kompresor|zavesna lista|davkovac saponatu|soklova lista|latkovy plot branka|barva na stenu|hydroizolacni sterka|tesnici roh|terasovy vrut|vrut do dreva|vrut do sadrokartonu|zavitova tyc|rektifikacni terc|deska pod umyvadlo|stolova deska|koupelnovy ventilator|fasadni penetrace|penetracni nater|led pasek|umela rostlina monstera|ventilova vlozka|vratovy sroub|plotova zastena|brasna s naradim)( |$)' then return 'home'; end if;
  end if;

  if v_source_store='obi' or lower(coalesce(p_metadata->>'structured_source',''))='obi-product-page-v1' then
    if n ~ '(^| )(elektricky bojler|elektricky ohrivac vody)( |$)' then return 'electronics'; end if;
    return 'home';
  end if;

  return 'other';
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable
parallel safe
set search_path to 'public','pg_temp'
as $$ select 25 $$;

update public.products p
set metadata = coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object('source_store_slug','obi')
where lower(coalesce(p.metadata->>'structured_source',''))='obi-product-page-v1'
  and coalesce(p.metadata->>'source_store_slug','')=''
  and exists (
    select 1 from public.offers o join public.stores s on s.id=o.store_id
    where o.product_id=p.id and s.slug='obi'
  )
  and not exists (
    select 1 from public.offers o join public.stores s on s.id=o.store_id
    where o.product_id=p.id and s.slug<>'obi'
  );

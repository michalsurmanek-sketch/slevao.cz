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

  return 'other';
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable
parallel safe
set search_path to 'public','pg_temp'
as $$ select 24 $$;

create or replace function public.auto_assign_product_filter_group()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
declare
  v_inferred text;
  v_version integer := public.product_filter_group_classifier_version();
  v_old_auto boolean := false;
  v_new_auto boolean := false;
  v_explicit_change boolean := false;
begin
  v_new_auto := coalesce(new.metadata->>'filter_group_source','')='auto_classifier';

  if tg_op='UPDATE' then
    v_old_auto := coalesce(old.metadata->>'filter_group_source','')='auto_classifier';
    v_explicit_change := new.filter_group is distinct from old.filter_group;
  end if;

  if v_explicit_change then
    new.metadata := (coalesce(new.metadata,'{}'::jsonb) - 'filter_group_classifier_version')
      || jsonb_build_object(
        'filter_group_source','explicit',
        'filter_group_classifier_checked_version',v_version,
        'filter_group_classifier_checked_at',now()
      );
    return new;
  end if;

  if coalesce(nullif(trim(new.filter_group),''),'other')='other' or v_old_auto or v_new_auto then
    v_inferred := public.infer_product_filter_group_high_confidence(new.name,new.quantity_text);
    if v_inferred='other' then
      v_inferred := public.infer_product_filter_group_source_rules(new.name,new.quantity_text,new.metadata);
    end if;
    if v_inferred='other' then
      v_inferred := public.infer_product_filter_group_auto(new.name,new.category_id,new.quantity_text,new.metadata);
    end if;

    if v_inferred <> 'other' then
      new.filter_group := v_inferred;
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
        'filter_group_source','auto_classifier',
        'filter_group_classifier_version',v_version,
        'filter_group_classifier_checked_version',v_version,
        'filter_group_classifier_checked_at',now()
      );
    else
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
        'filter_group_classifier_checked_version',v_version,
        'filter_group_classifier_checked_at',now()
      );
      if v_old_auto or v_new_auto then
        new.filter_group := 'other';
        new.metadata := new.metadata || jsonb_build_object(
          'filter_group_source','auto_classifier',
          'filter_group_classifier_version',v_version
        );
      end if;
    end if;
  end if;

  return new;
end;
$function$;

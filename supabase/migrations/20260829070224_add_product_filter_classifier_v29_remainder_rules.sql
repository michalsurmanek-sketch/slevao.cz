create or replace function public.infer_product_filter_group_remainder_v29(
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
  n text := public.normalize_text(concat_ws(' ',coalesce(p_name,''),coalesce(p_quantity_text,'')));
  v_source_store text := lower(coalesce(p_metadata->>'source_store_slug',''));
begin
  if n ~ '(^| )pedro kysele duhove pasky( |$)' then return 'food'; end if;

  if v_source_store='action' then
    if n ~ 'bezdratova stolni lampa|nastenna dekorace s led osvetlenim|podzimni trpaslik' then return 'home'; end if;
    if n ~ 'rychlonabijecka' then return 'electronics'; end if;
    if n ~ 'haribo crazy mix' then return 'food'; end if;
  end if;

  if v_source_store='auto-kelly' then
    if n ~ 'fine microfiber polishing pad|sada tesneni hlavni pistnice hlavnich nuzek|skutr maxon ardour|vnitrni pistnicove tesneni' then return 'auto'; end if;
    if n='klavesnice' then return 'electronics'; end if;
  end if;

  if v_source_store='ca' and n='minisukne' then return 'fashion'; end if;

  if v_source_store='globus' then
    if n ~ 'combo wl sada sequence .* yenkee' then return 'electronics'; end if;
    if n ~ 'destnik licencovany chlapecky' then return 'fashion'; end if;
    if n ~ '^lahev pl strike ' then return 'home'; end if;
    if n ~ '^lego minecraft' then return 'toys'; end if;
    if n ~ '^prego (ob vol cas de|sport ob de)' then return 'fashion'; end if;
    if n ~ '^spejle uzenarske ' then return 'home'; end if;
    if n ~ '^toto nuzky lux ' then return 'school'; end if;
    if n ~ 'kuch( |\.)? uterky|kuchynske uterky' then return 'drugstore'; end if;
    if n ~ '^vileda mikrohadrik ' then return 'home'; end if;
  end if;

  if v_source_store='kaufland' then
    if n ~ '^tento kuchynske uterky' then return 'drugstore'; end if;
    if n ~ '^tronic elektricke orezavatko ' then return 'school'; end if;
  end if;

  if v_source_store='kosik' then
    if n ~ '^bio kokos drink eat' then return 'food'; end if;
    if n ~ '^intex nafukovaci kruh ' then return 'toys'; end if;
    if n ~ '^intex pumpa rucni ' then return 'sports'; end if;
  end if;

  if v_source_store='rohlik' and n ~ '^semix ovsane(k|k ) visen' then return 'food'; end if;
  if v_source_store='rossmann' and n ~ '^kuchynske uterky ' then return 'drugstore'; end if;

  if v_source_store='tedi' and n ~ '^(chladici box|chladici taska|davkovac napoju|dozy na potraviny|grilovaci jehly( s uchyty)?|grilovaci kleste|grilovaci lopatka|kelimek)$' then
    return 'home';
  end if;

  if v_source_store='tesco' then
    if n='deluxe kytice' then return 'garden'; end if;
    if n ~ '^vybrane tesco free from vyrobky' then return 'food'; end if;
  end if;

  if v_source_store='zabka' and n ~ '^podebradka prolinie ' then return 'drinks'; end if;

  return 'other';
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable
parallel safe
set search_path to 'public','pg_temp'
as $$ select 29 $$;

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
      v_inferred := public.infer_product_filter_group_activity_v28(new.name,new.quantity_text,new.metadata);
    end if;
    if v_inferred='other' then
      v_inferred := public.infer_product_filter_group_remainder_v29(new.name,new.quantity_text,new.metadata);
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

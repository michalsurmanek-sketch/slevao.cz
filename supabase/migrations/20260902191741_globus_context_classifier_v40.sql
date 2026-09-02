create or replace function public.infer_product_filter_group_globus_context_v40(p_name text)
returns text
language plpgsql
stable parallel safe
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(p_name,''));
begin
  if n='' then return 'other'; end if;

  if n ~ '(gourmet perle)' then return 'pets'; end if;
  if n ~ '(natelnik|trenyrky|sneaker 4p)' then return 'fashion'; end if;
  if n ~ '(fixy|heftbox|pero gumovaci|nuzky creativ)' then return 'school'; end if;
  if n ~ '(bublifuk|dino tatra|gabinin kouzelny domek|plysova zirafa|pokemon figurky|stavebnice|priserka s efekty|teddies projektor|teddies spirala|udelej si svuj naramek|wiky auto|auto s vrtulkou|auto terenni|made letadlo)' then return 'toys'; end if;
  if n ~ '(sencor .*radio|led pracovni lampa|rozbocovaci zasuvka|zasuvka prima)' then return 'electronics'; end if;
  if n ~ '(agro textilie|chryzantema|kvetnik|odpuzovac krtku|mata v kvetinaci|travnikove hnojivo|zahradni nuzky|rodenticid|podlozka klekaci)' then return 'garden'; end if;
  if n ~ '(magu.*500 ml|ginger shot|matcha latte)' then return 'drinks'; end if;
  if n ~ '(zeleninovy vyvar|brownies|arizonky|gummies biosaurus|coko kokosky|good lunch|veggie rizek|jablecne pyre|vafle|dobacky|morske rasy|kimchi|sojakrem|tofu|manapowder|medove kulicky|ovsanek|cockove 100 g|hummes|tempeh|pudink|violife|ovocne lizatko|fermentik|dort slehackovy)' then return 'food'; end if;
  if n ~ '(balici paska|kotouc rezny|tavna pistole|podpalovac|malirska renovacni souprava|izolacni paska|baterie drezova|kelimek na sadru|kryci nepromokava plachta|kovany univerzalni nuz|kuchynsky nuz|kos bezdot|sada priboru|metr svinovaci|rozprasovaci mop|organizer|paska instalaterska|pattex|pekac|prostirani|stetec malirsky|vedro zednicke|rukavice pracovni|houbicka|vysokopevnostni paska|doza s vikem|dzban 1 3 l|forma silikonova|koupelnova predlozka|motouz)' then return 'home'; end if;

  return 'other';
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable parallel safe
set search_path to 'public','pg_temp'
as $function$ select 40 $function$;

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
  v_source_category boolean := false;
  v_kaufland_context boolean := false;
  v_globus_context boolean := false;
  v_source_store text;
  v_source_root text;
  v_source_path text;
begin
  if coalesce(new.metadata->>'created_from_kaufland_ssr','false')='true'
     and nullif(trim(new.metadata->>'kaufland_category'),'') is not null
     and nullif(trim(new.metadata->>'source_category_root'),'') is null
     and coalesce(nullif(trim(new.metadata->>'source_store_slug'),''),'kaufland')='kaufland' then
    new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
      'source_store_slug','kaufland',
      'source_category_root',new.metadata->>'kaufland_category',
      'source_category_path',new.metadata->>'kaufland_category',
      'source_category_items',jsonb_build_array(new.metadata->>'kaufland_category'),
      'source_category_source','kaufland-ssr-category-v1'
    );
  end if;

  v_source_store := new.metadata->>'source_store_slug';
  v_source_root := new.metadata->>'source_category_root';
  v_source_path := new.metadata->>'source_category_path';
  v_new_auto := coalesce(new.metadata->>'filter_group_source','')='auto_classifier';
  if tg_op='UPDATE' then
    v_old_auto := coalesce(old.metadata->>'filter_group_source','')='auto_classifier';
    v_explicit_change := new.filter_group is distinct from old.filter_group;
  end if;
  if v_explicit_change then
    new.metadata := (coalesce(new.metadata,'{}'::jsonb) - 'filter_group_classifier_version') || jsonb_build_object('filter_group_source','explicit','filter_group_classifier_checked_version',v_version,'filter_group_classifier_checked_at',now());
    return new;
  end if;
  if coalesce(nullif(trim(new.filter_group),''),'other')='other' or v_old_auto or v_new_auto then
    v_inferred := public.infer_product_filter_group_source_category_v37(v_source_store,v_source_root,v_source_path);
    v_source_category := v_inferred <> 'other';
    if v_inferred='other' and lower(trim(coalesce(v_source_store,'')))='kaufland' then
      v_inferred := public.infer_product_filter_group_kaufland_context_v39(new.name,v_source_root);
      v_kaufland_context := v_inferred <> 'other';
    end if;
    if v_inferred='other' and lower(trim(coalesce(v_source_store,'')))='globus' then
      v_inferred := public.infer_product_filter_group_globus_context_v40(new.name);
      v_globus_context := v_inferred <> 'other';
    end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_gap_v34(new.name,new.quantity_text,new.metadata); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_high_confidence(new.name,new.quantity_text); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_source_rules_v33(new.name,new.quantity_text,new.metadata); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_activity_v28(new.name,new.quantity_text,new.metadata); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_remainder_v29(new.name,new.quantity_text,new.metadata); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_verified_v30(new.name,new.quantity_text,new.metadata); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_auto(new.name,new.category_id,new.quantity_text,new.metadata); end if;
    if v_inferred <> 'other' then
      new.filter_group := v_inferred;
      if v_source_category then new.classification_source := 'source-category-v40';
      elsif v_kaufland_context then new.classification_source := 'kaufland-context-v39';
      elsif v_globus_context then new.classification_source := 'globus-context-v40';
      elsif public.infer_product_filter_group_gap_v34(new.name,new.quantity_text,new.metadata) <> 'other' then new.classification_source := 'gap-rules-v34';
      end if;
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object('filter_group_source','auto_classifier','filter_group_classifier_version',v_version,'filter_group_classifier_checked_version',v_version,'filter_group_classifier_checked_at',now());
    else
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object('filter_group_classifier_checked_version',v_version,'filter_group_classifier_checked_at',now());
      if v_old_auto or v_new_auto then
        new.filter_group := 'other';
        new.metadata := new.metadata || jsonb_build_object('filter_group_source','auto_classifier','filter_group_classifier_version',v_version);
      end if;
    end if;
  end if;
  return new;
end;
$function$;

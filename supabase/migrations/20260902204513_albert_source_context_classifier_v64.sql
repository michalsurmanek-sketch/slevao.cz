create or replace function public.infer_product_filter_group_albert_context_v64(p_name text, p_quantity_text text)
returns text
language plpgsql
stable parallel safe
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(p_name,''));
  q text := lower(unaccent(coalesce(p_quantity_text,'')));
begin
  if n ~ 'frizzante' then return 'drinks'; end if;
  if n ~ '6pack' and q ~ '[0-9]+\* *[0-9]+([,.][0-9]+)? *(ml|l)' then return 'drinks'; end if;
  return 'other';
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable parallel safe
set search_path to 'public','pg_temp'
as $function$ select 64 $function$;

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
  v_benu_context boolean := false;
  v_ikea_context boolean := false;
  v_makro_context boolean := false;
  v_penny_context boolean := false;
  v_action_context boolean := false;
  v_kosik_context boolean := false;
  v_rohlik_context boolean := false;
  v_tesco_context boolean := false;
  v_auto_kelly_context boolean := false;
  v_albert_context boolean := false;
  v_page_consensus boolean := false;
  v_source_store text;
  v_source_root text;
  v_source_path text;
  v_consensus_group text;
begin
  if coalesce(new.metadata->>'created_from_kaufland_ssr','false')='true'
     and nullif(trim(coalesce(new.metadata->>'kaufland_category','')),'') is not null
     and nullif(trim(coalesce(new.metadata->>'source_category_root','')),'') is null
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
  v_consensus_group := lower(trim(coalesce(new.metadata->>'source_page_consensus_group','')));
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
    v_inferred := 'other';
    if lower(trim(coalesce(v_source_store,''))) in ('lidl','hruska','flop','billa')
       and v_consensus_group in ('food','drinks','drugstore','home','garden','electronics','fashion','school','toys','pets','sports','auto','pharmacy') then
      v_inferred := v_consensus_group;
      v_page_consensus := true;
    end if;
    if v_inferred='other' then
      v_inferred := public.infer_product_filter_group_source_category_v37(v_source_store,v_source_root,v_source_path);
      v_source_category := v_inferred <> 'other';
    end if;
    if v_inferred='other' and lower(trim(coalesce(v_source_store,'')))='kaufland' then
      v_inferred := public.infer_product_filter_group_kaufland_context_v46(new.name,v_source_root,new.quantity_text);
      v_kaufland_context := v_inferred <> 'other';
    end if;
    if v_inferred='other' and lower(trim(coalesce(v_source_store,'')))='globus' then
      v_inferred := public.infer_product_filter_group_globus_context_v40(new.name);
      v_globus_context := v_inferred <> 'other';
    end if;
    if v_inferred='other' and coalesce(new.metadata->>'source_benu_context','false')='true' then
      v_inferred := public.infer_product_filter_group_benu_context_v55(new.name,new.quantity_text);
      v_benu_context := v_inferred <> 'other';
    end if;
    if v_inferred='other' and lower(trim(coalesce(v_source_store,'')))='ikea' then
      v_inferred := public.infer_product_filter_group_ikea_context_v56(new.name,new.quantity_text);
      v_ikea_context := v_inferred <> 'other';
    end if;
    if v_inferred='other' and lower(trim(coalesce(v_source_store,'')))='makro' then
      v_inferred := public.infer_product_filter_group_makro_context_v57(new.name,new.quantity_text);
      v_makro_context := v_inferred <> 'other';
    end if;
    if v_inferred='other' and coalesce(new.metadata->>'source_penny_context','false')='true' then
      v_inferred := public.infer_product_filter_group_penny_context_v58(new.name,new.quantity_text);
      v_penny_context := v_inferred <> 'other';
    end if;
    if v_inferred='other' and lower(trim(coalesce(v_source_store,'')))='action' then
      v_inferred := public.infer_product_filter_group_action_context_v59(new.name,new.quantity_text);
      v_action_context := v_inferred <> 'other';
    end if;
    if v_inferred='other' and lower(trim(coalesce(v_source_store,'')))='kosik' then
      v_inferred := public.infer_product_filter_group_kosik_context_v60(new.name,new.quantity_text);
      v_kosik_context := v_inferred <> 'other';
    end if;
    if v_inferred='other' and lower(trim(coalesce(v_source_store,'')))='rohlik' then
      v_inferred := public.infer_product_filter_group_rohlik_context_v61(new.name,new.quantity_text);
      v_rohlik_context := v_inferred <> 'other';
    end if;
    if v_inferred='other' and lower(trim(coalesce(v_source_store,'')))='tesco' then
      v_inferred := public.infer_product_filter_group_tesco_context_v62(new.name,new.quantity_text,new.metadata);
      v_tesco_context := v_inferred <> 'other';
    end if;
    if v_inferred='other' and lower(trim(coalesce(v_source_store,'')))='auto-kelly' then
      v_inferred := public.infer_product_filter_group_auto_kelly_context_v63(new.name,new.quantity_text);
      v_auto_kelly_context := v_inferred <> 'other';
    end if;
    if v_inferred='other' and lower(trim(coalesce(v_source_store,'')))='albert' then
      v_inferred := public.infer_product_filter_group_albert_context_v64(new.name,new.quantity_text);
      v_albert_context := v_inferred <> 'other';
    end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_generic_terms_v54(new.name,new.quantity_text); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_gap_v34(new.name,new.quantity_text,new.metadata); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_high_confidence(new.name,new.quantity_text); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_source_rules_v33(new.name,new.quantity_text,new.metadata); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_activity_v28(new.name,new.quantity_text,new.metadata); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_remainder_v29(new.name,new.quantity_text,new.metadata); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_verified_v30(new.name,new.quantity_text,new.metadata); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_auto(new.name,new.category_id,new.quantity_text,new.metadata); end if;
    if v_inferred <> 'other' then
      new.filter_group := v_inferred;
      if v_page_consensus then
        new.classification_source := case lower(trim(coalesce(v_source_store,''))) when 'flop' then 'source-page-consensus-v47' when 'billa' then 'source-page-consensus-v52' else 'source-page-consensus-v43' end;
      elsif v_source_category then new.classification_source := 'source-category-v41';
      elsif v_kaufland_context then new.classification_source := 'kaufland-context-v46';
      elsif v_globus_context then new.classification_source := 'globus-context-v40';
      elsif v_benu_context then new.classification_source := 'benu-context-v55';
      elsif v_ikea_context then new.classification_source := 'ikea-context-v56';
      elsif v_makro_context then new.classification_source := 'makro-context-v57';
      elsif v_penny_context then new.classification_source := 'penny-context-v58';
      elsif v_action_context then new.classification_source := 'action-context-v59';
      elsif v_kosik_context then new.classification_source := 'kosik-context-v60';
      elsif v_rohlik_context then new.classification_source := 'rohlik-context-v61';
      elsif v_tesco_context then new.classification_source := 'tesco-context-v62';
      elsif v_auto_kelly_context then new.classification_source := 'auto-kelly-context-v63';
      elsif v_albert_context then new.classification_source := 'albert-context-v64';
      elsif public.infer_product_filter_group_generic_terms_v54(new.name,new.quantity_text) <> 'other' then new.classification_source := 'generic-terms-v54';
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

update public.products p
set metadata=coalesce(p.metadata,'{}'::jsonb)
where p.is_active is true
  and coalesce(nullif(btrim(p.filter_group),''),'other')='other'
  and exists (
    select 1 from public.offers o join public.stores s on s.id=o.store_id
    where o.product_id=p.id and s.slug='albert' and o.status='published'
      and o.valid_from <= (now() at time zone 'Europe/Prague')::date
      and o.valid_to >= (now() at time zone 'Europe/Prague')::date
  );
create or replace function public.infer_product_filter_group_kaufland_context_v46(p_name text,p_category_root text,p_quantity_text text)
returns text
language plpgsql
stable parallel safe
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(p_name,''));
  c text := public.normalize_text(coalesce(p_category_root,''));
  q text := public.normalize_text(coalesce(p_quantity_text,''));
  v text;
begin
  v := public.infer_product_filter_group_kaufland_context_v39(p_name,p_category_root);
  if v <> 'other' then return v; end if;

  if c like 'spotrebni zbozi%'
     and n ~ '(^| )lahev( |$)'
     and q ~ 'cena za 1 kus' then
    return 'home';
  end if;

  if c='ovoce zelenina rostliny'
     and n ~ '(^| )[a-z]{3,} vulgaris( |$)' then
    return 'garden';
  end if;

  if c like 'mimoradna nabidka%'
     and n ~ '(^| )krem( |$)'
     and q ~ '(^| )[0-9]+([,.][0-9]+)? ml( |$)'
     and n !~ '(balsamico|karamel|pistaci|orech|cokolad|kremove)' then
    return 'drugstore';
  end if;

  if c='drogerie detska vyziva a pece krmiva'
     and q ~ 'ml.*kus' then
    return 'drugstore';
  end if;

  return 'other';
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable parallel safe
set search_path to 'public','pg_temp'
as $function$ select 46 $function$;

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
  v_page_consensus boolean := false;
  v_source_store text;
  v_source_root text;
  v_source_path text;
  v_consensus_group text;
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
    if lower(trim(coalesce(v_source_store,''))) in ('lidl','hruska')
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
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_generic_terms_v45(new.name,new.quantity_text); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_gap_v34(new.name,new.quantity_text,new.metadata); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_high_confidence(new.name,new.quantity_text); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_source_rules_v33(new.name,new.quantity_text,new.metadata); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_activity_v28(new.name,new.quantity_text,new.metadata); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_remainder_v29(new.name,new.quantity_text,new.metadata); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_verified_v30(new.name,new.quantity_text,new.metadata); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_auto(new.name,new.category_id,new.quantity_text,new.metadata); end if;
    if v_inferred <> 'other' then
      new.filter_group := v_inferred;
      if v_page_consensus then new.classification_source := 'source-page-consensus-v43';
      elsif v_source_category then new.classification_source := 'source-category-v41';
      elsif v_kaufland_context then new.classification_source := 'kaufland-context-v46';
      elsif v_globus_context then new.classification_source := 'globus-context-v40';
      elsif public.infer_product_filter_group_generic_terms_v45(new.name,new.quantity_text) <> 'other' then new.classification_source := 'generic-terms-v45';
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

update products p
set metadata=coalesce(p.metadata,'{}'::jsonb)
where p.is_active is true
  and coalesce(nullif(trim(p.filter_group),''),'other')='other'
  and exists (
    select 1 from offers o join stores s on s.id=o.store_id
    where o.product_id=p.id and o.status='published'
      and o.valid_from<=current_date and o.valid_to>=current_date
      and s.slug='kaufland'
  );
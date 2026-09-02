create or replace function public.infer_product_filter_group_tesco_context_v62(p_name text,p_quantity_text text,p_metadata jsonb)
returns text
language plpgsql
stable parallel safe
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(p_name,'')||' '||coalesce(p_metadata->>'source_tesco_product_name',''));
begin
  if n ~ 'calluna' then return 'garden'; end if;
  if n ~ 'majonez' then return 'food'; end if;
  if n ~ '(^| )energy( |$)' then return 'drinks'; end if;
  if n ~ '(pokozku hlavy|pok hlavy|avivaz)' then return 'drugstore'; end if;
  if n ~ '(kuchynske spotrebice|vysavac|rucni slehac)' then return 'electronics'; end if;
  return 'other';
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable parallel safe
set search_path to 'public','pg_temp'
as $function$ select 62 $function$;

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

create or replace function public.propagate_tesco_product_descriptor_v62()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
declare
  v_is_tesco boolean := false;
  v_descriptor text;
begin
  if new.product_id is null or new.store_id is null then return new; end if;
  select exists(select 1 from public.stores s where s.id=new.store_id and s.slug='tesco') into v_is_tesco;
  if not v_is_tesco then return new; end if;
  v_descriptor := nullif(btrim(coalesce(new.metadata->>'tesco_product_name','')),'');
  if v_descriptor is null then return new; end if;
  update public.products p
     set metadata=coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
       'source_tesco_product_name',v_descriptor,
       'source_tesco_descriptor_source','apollo-offer-metadata-v62'
     )
   where p.id=new.product_id
     and coalesce(p.metadata->>'source_tesco_product_name','') is distinct from v_descriptor;
  return new;
end;
$function$;

drop trigger if exists trg_propagate_tesco_product_descriptor_v62 on public.offers;
create trigger trg_propagate_tesco_product_descriptor_v62
after insert or update of store_id,product_id,metadata on public.offers
for each row execute function public.propagate_tesco_product_descriptor_v62();

with latest as (
  select distinct on (o.product_id) o.product_id,o.metadata->>'tesco_product_name' descriptor
  from public.offers o
  join public.stores s on s.id=o.store_id and s.slug='tesco'
  where o.status='published'
    and o.valid_to >= (now() at time zone 'Europe/Prague')::date
    and nullif(btrim(coalesce(o.metadata->>'tesco_product_name','')),'') is not null
  order by o.product_id,o.updated_at desc
)
update public.products p
set metadata=coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
  'source_tesco_product_name',l.descriptor,
  'source_tesco_descriptor_source','apollo-offer-metadata-v62'
)
from latest l
where p.id=l.product_id
  and coalesce(p.metadata->>'source_tesco_product_name','') is distinct from l.descriptor;
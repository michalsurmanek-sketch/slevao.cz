create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable parallel safe
set search_path to 'public','pg_temp'
as $function$ select 41 $function$;

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
    if lower(trim(coalesce(v_source_store,'')))='lidl'
       and v_consensus_group in ('food','drinks','drugstore','home','garden','electronics','fashion','school','toys','pets','sports','auto','pharmacy') then
      v_inferred := v_consensus_group;
      v_page_consensus := true;
    end if;
    if v_inferred='other' then
      v_inferred := public.infer_product_filter_group_source_category_v37(v_source_store,v_source_root,v_source_path);
      v_source_category := v_inferred <> 'other';
    end if;
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
      if v_page_consensus then new.classification_source := 'source-page-consensus-v41';
      elsif v_source_category then new.classification_source := 'source-category-v41';
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

create or replace function private.refresh_lidl_page_consensus_classification()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
set statement_timeout to '30s'
as $function$
declare
  v_updated integer := 0;
begin
  with current_lidl as (
    select
      o.product_id,
      o.metadata->>'import_id' as import_id,
      (o.metadata->>'leaflet_page')::integer as leaflet_page,
      p.filter_group
    from public.offers o
    join public.stores s on s.id=o.store_id and s.slug='lidl'
    join public.products p on p.id=o.product_id
    where o.status='published'
      and o.valid_to >= (now() at time zone 'Europe/Prague')::date
      and coalesce(o.metadata->>'adapter','')='lidl-verified-pdf-text-v2'
      and nullif(o.metadata->>'import_id','') is not null
      and o.metadata->>'leaflet_page' ~ '^[0-9]+$'
  ), page_stats as (
    select import_id,leaflet_page,
           count(distinct product_id) filter (where filter_group is not null and btrim(filter_group)<>'' and filter_group<>'other') known_count,
           count(distinct filter_group) filter (where filter_group is not null and btrim(filter_group)<>'' and filter_group<>'other') group_count,
           min(filter_group) filter (where filter_group is not null and btrim(filter_group)<>'' and filter_group<>'other') consensus_group
    from current_lidl
    group by import_id,leaflet_page
    having count(distinct product_id) filter (where filter_group is not null and btrim(filter_group)<>'' and filter_group<>'other') >= 3
       and count(distinct filter_group) filter (where filter_group is not null and btrim(filter_group)<>'' and filter_group<>'other') = 1
  ), candidates as (
    select distinct p.id,cl.import_id,cl.leaflet_page,ps.consensus_group,ps.known_count
    from current_lidl cl
    join page_stats ps using(import_id,leaflet_page)
    join public.products p on p.id=cl.product_id
    where (p.filter_group is null or btrim(p.filter_group)='')
      and coalesce(p.metadata->>'filter_group_source','')<>'explicit'
  )
  update public.products p
  set metadata=coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
      'source_store_slug','lidl',
      'source_leaflet_import_id',c.import_id,
      'source_leaflet_page',c.leaflet_page,
      'source_page_consensus_group',c.consensus_group,
      'source_page_consensus_known_count',c.known_count,
      'source_page_consensus_checked_at',now()
  )
  from candidates c
  where p.id=c.id;
  get diagnostics v_updated=row_count;

  return jsonb_build_object('ok',true,'updated',v_updated);
end;
$function$;

revoke all on function private.refresh_lidl_page_consensus_classification() from public;
grant execute on function private.refresh_lidl_page_consensus_classification() to service_role;

select cron.unschedule(jobid) from cron.job where jobname='classify-lidl-page-consensus';
select cron.schedule(
  'classify-lidl-page-consensus',
  '13 * * * *',
  $$select private.refresh_lidl_page_consensus_classification();$$
);

select private.refresh_lidl_page_consensus_classification();

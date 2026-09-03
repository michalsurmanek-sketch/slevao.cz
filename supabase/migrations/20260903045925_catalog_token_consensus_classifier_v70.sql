create or replace function private.refresh_catalog_token_consensus_v70()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
set statement_timeout to '30s'
as $function$
declare
  v_marked integer := 0;
begin
  with today as (
    select (now() at time zone 'Europe/Prague')::date d
  ), current_unresolved as (
    select distinct p.id,p.name,p.quantity_text,
      (select tok
         from regexp_split_to_table(public.normalize_text(p.name),' +') tok
        where length(tok)>=4
          and tok not in (
            'original','premium','protein','extra','classic','vybrane','druhy','smetanovy','damsky','ovocny','nebo',
            'gold','selection','miracle','prolinie','prostredek','kapsicka','kapsicky','baleni','velky','vanilkovy',
            'sada','tablety','napoj','napoje','ochuceny','ochucena','ochucene','minerali','mineralni','kusy','cena'
          )
        limit 1) as anchor
    from public.offers o
    join public.products p on p.id=o.product_id
    cross join today t
    where o.status='published'
      and o.is_verified=true
      and o.valid_from<=t.d
      and o.valid_to>=t.d
      and p.is_active=true
      and coalesce(nullif(btrim(p.filter_group),''),'other')='other'
      and coalesce(p.metadata->>'filter_group_source','')<>'explicit'
  ), ref_products as (
    select distinct p.id,p.filter_group,st.slug,public.normalize_text(p.name) as normalized_name
    from public.offers o
    join public.products p on p.id=o.product_id
    join public.stores st on st.id=o.store_id
    cross join today t
    where o.status='published'
      and o.is_verified=true
      and o.valid_from<=t.d
      and o.valid_to>=t.d
      and p.is_active=true
      and p.filter_group is not null
      and btrim(p.filter_group)<>''
      and p.filter_group<>'other'
      and coalesce(p.classification_source,'')<>'catalog-token-consensus-v70'
  ), stats as (
    select u.id,u.anchor,u.quantity_text,
      count(distinct r.id)::integer as ref_count,
      count(distinct r.filter_group)::integer as group_count,
      min(r.filter_group) as consensus_group,
      count(distinct r.slug)::integer as store_count
    from current_unresolved u
    join ref_products r
      on u.anchor is not null
     and (' '||r.normalized_name||' ') like ('% '||u.anchor||' %')
    group by u.id,u.anchor,u.quantity_text
  ), eligible as (
    select *
    from stats
    where ref_count>=5
      and group_count=1
      and store_count>=2
      and consensus_group in ('food','drinks','drugstore','home','garden','electronics','fashion','school','toys','pets','sports','auto','pharmacy')
      and (
        consensus_group not in ('food','drinks')
        or (consensus_group='food' and public.normalize_text(coalesce(quantity_text,'')) ~ '(^| )[0-9]+([,.][0-9]+)?([ -][0-9]+([,.][0-9]+)?)? *(g|kg)( |$)')
        or (consensus_group='drinks' and public.normalize_text(coalesce(quantity_text,'')) ~ '(^| )[0-9]+([,.][0-9]+)?([ -][0-9]+([,.][0-9]+)?)? *(ml|l)( |$)')
      )
  )
  update public.products p
     set metadata=coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
       'source_catalog_consensus_version','70',
       'source_catalog_consensus_group',e.consensus_group,
       'source_catalog_consensus_anchor',e.anchor,
       'source_catalog_consensus_ref_count',e.ref_count,
       'source_catalog_consensus_store_count',e.store_count,
       'source_catalog_consensus_source','current-verified-multistore-token-v70',
       'source_catalog_consensus_checked_at',now()
     )
    from eligible e
   where p.id=e.id;
  get diagnostics v_marked=row_count;
  return jsonb_build_object('ok',true,'marked',v_marked);
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable parallel safe
set search_path to 'public','pg_temp'
as $function$ select 70 $function$;

do $patch$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.auto_assign_product_filter_group()'::regprocedure);
  v_new := replace(v_def,
    'v_albert_context boolean := false; v_page_consensus boolean := false;',
    'v_albert_context boolean := false; v_catalog_consensus boolean := false; v_page_consensus boolean := false;');
  if v_new=v_def then raise exception 'v70 patch failed at declaration'; end if;
  v_def := v_new;

  v_new := replace(v_def,
    'if v_inferred=''other'' then v_inferred:=public.infer_product_filter_group_source_category_v37(v_source_store,v_source_root,v_source_path); v_source_category:=v_inferred<>''other''; end if;',
    'if v_inferred=''other'' and coalesce(new.metadata->>''source_catalog_consensus_version'','''')=''70'' and lower(trim(coalesce(new.metadata->>''source_catalog_consensus_group'',''''))) in (''food'',''drinks'',''drugstore'',''home'',''garden'',''electronics'',''fashion'',''school'',''toys'',''pets'',''sports'',''auto'',''pharmacy'') then v_inferred:=lower(trim(new.metadata->>''source_catalog_consensus_group'')); v_catalog_consensus:=true; end if;
    if v_inferred=''other'' then v_inferred:=public.infer_product_filter_group_source_category_v37(v_source_store,v_source_root,v_source_path); v_source_category:=v_inferred<>''other''; end if;');
  if v_new=v_def then raise exception 'v70 patch failed at inference'; end if;
  v_def := v_new;

  v_new := replace(v_def,
    'elsif v_source_category then new.classification_source:=''source-category-v41'';',
    'elsif v_catalog_consensus then new.classification_source:=''catalog-token-consensus-v70''; elsif v_source_category then new.classification_source:=''source-category-v41'';');
  if v_new=v_def then raise exception 'v70 patch failed at source attribution'; end if;

  execute v_new;
end;
$patch$;

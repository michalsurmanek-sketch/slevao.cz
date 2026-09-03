create or replace function private.refresh_catalog_family_consensus_v76()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
set statement_timeout to '30s'
as $function$
declare
  v_marked integer := 0;
begin
  with params as (select (now() at time zone 'Europe/Prague')::date d),
  current_unresolved as (
    select distinct p.id,p.name,p.quantity_text,
      (select tok from regexp_split_to_table(public.normalize_text(p.name),' +') tok
        where length(tok)>=4
          and tok not in ('original','premium','protein','extra','classic','vybrane','druhy','smetanovy','damsky','ovocny','nebo','gold','selection','miracle','prolinie','prostredek','kapsicka','kapsicky','baleni','velky','vanilkovy','sada','tablety','napoj','napoje','ochuceny','ochucena','ochucene','mineralni','kusy','cena')
        limit 1) anchor
    from public.offers o join public.products p on p.id=o.product_id cross join params x
    where o.status='published' and o.is_verified=true and o.valid_from<=x.d and o.valid_to>=x.d
      and p.is_active=true and coalesce(nullif(btrim(p.filter_group),''),'other')='other'
      and coalesce(p.metadata->>'filter_group_source','')<>'explicit'
  ), refs as (
    select p.id,p.filter_group,public.normalize_text(p.name) normalized_name
    from public.products p
    where p.is_active=true and p.filter_group is not null and btrim(p.filter_group)<>'' and p.filter_group<>'other'
      and coalesce(p.classification_source,'') not like 'catalog-%consensus%'
  ), family as (
    select u.id,u.quantity_text,u.anchor,
      count(distinct r.id)::integer ref_count,
      count(distinct r.filter_group)::integer group_count,
      min(r.filter_group) consensus_group
    from current_unresolved u
    join refs r on u.anchor is not null and (' '||r.normalized_name||' ') like ('% '||u.anchor||' %')
    group by u.id,u.quantity_text,u.anchor
  ), evidence as (
    select f.id,count(distinct st.slug)::integer evidence_store_count
    from family f
    join refs r on (' '||r.normalized_name||' ') like ('% '||f.anchor||' %') and r.filter_group=f.consensus_group
    join public.offers o on o.product_id=r.id and o.is_verified=true
    join public.stores st on st.id=o.store_id cross join params x
    where o.valid_to>=x.d-365
    group by f.id
  ), eligible as (
    select f.*,e.evidence_store_count
    from family f join evidence e using(id)
    where f.ref_count>=5 and f.group_count=1 and e.evidence_store_count>=2
      and f.consensus_group in ('food','drinks','drugstore','home','garden','electronics','fashion','school','toys','pets','sports','auto','pharmacy')
      and (
        f.consensus_group not in ('food','drinks')
        or (f.consensus_group='food' and public.normalize_text(coalesce(f.quantity_text,'')) ~ '(^| )[0-9]+([,.][0-9]+)?([ -][0-9]+([,.][0-9]+)?)? *(g|kg)( |$)')
        or (f.consensus_group='drinks' and public.normalize_text(coalesce(f.quantity_text,'')) ~ '(^| )[0-9]+([,.][0-9]+)?([ -][0-9]+([,.][0-9]+)?)? *(ml|l)( |$)')
        or (f.consensus_group in ('food','drinks') and coalesce(nullif(btrim(f.quantity_text),''),'')='' and f.ref_count>=7 and e.evidence_store_count>=3)
      )
  )
  update public.products p
     set metadata=coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
       'source_catalog_consensus_version','76',
       'source_catalog_consensus_group',e.consensus_group,
       'source_catalog_consensus_anchor',e.anchor,
       'source_catalog_consensus_ref_count',e.ref_count,
       'source_catalog_consensus_store_count',e.evidence_store_count,
       'source_catalog_consensus_source','active-family-plus-verified-store-evidence-v76',
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
as $function$ select 76 $function$;

do $patch$
declare v_def text; v_new text;
begin
  v_def:=pg_get_functiondef('public.auto_assign_product_filter_group()'::regprocedure);
  v_new:=replace(v_def,
    $old$coalesce(new.metadata->>'source_catalog_consensus_version','') in ('70','74')$old$,
    $new$coalesce(new.metadata->>'source_catalog_consensus_version','') in ('70','74','76')$new$);
  if v_new=v_def then raise exception 'v76 patch failed at accepted versions'; end if;
  v_def:=v_new;
  v_new:=replace(v_def,
    $old$new.classification_source:=case when coalesce(new.metadata->>'source_catalog_consensus_version','')='74' then 'catalog-family-consensus-v74' else 'catalog-token-consensus-v70' end;$old$,
    $new$new.classification_source:=case when coalesce(new.metadata->>'source_catalog_consensus_version','')='76' then 'catalog-family-consensus-v76' when coalesce(new.metadata->>'source_catalog_consensus_version','')='74' then 'catalog-family-consensus-v74' else 'catalog-token-consensus-v70' end;$new$);
  if v_new=v_def then raise exception 'v76 patch failed at source attribution'; end if;
  execute v_new;
end;
$patch$;

create or replace function private.refresh_billa_unit_row_consensus_v88()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
set statement_timeout to '30s'
as $function$
declare
  v_conflicts integer:=0;
  v_marked integer:=0;
begin
  with params as (select (now() at time zone 'Europe/Prague')::date d),
  current_imports as (
    select distinct (o.metadata->>'import_id')::uuid import_id
    from public.offers o join public.stores st on st.id=o.store_id cross join params x
    where st.slug='billa' and o.status='published' and o.is_verified=true
      and o.valid_from<=x.d and o.valid_to>=x.d
      and coalesce(o.metadata->>'import_id','') ~ '^[0-9a-f-]{36}$'
  ), items as (
    select li.id,li.import_id,li.product_id,li.source_page,li.quantity_text,p.name,p.filter_group,
      case when public.normalize_text(coalesce(li.quantity_text,'')) ~ '(^| )[0-9]+([,.][0-9]+)? *(g|kg)( |$)' then 'mass'
           when public.normalize_text(coalesce(li.quantity_text,'')) ~ '(^| )[0-9]+([,.][0-9]+)? *(ml|l)( |$)' then 'volume'
           when public.normalize_text(coalesce(li.quantity_text,'')) ~ '(^| )[0-9]+ *(ks|kus|kusu|davek|davka)( |$)' then 'count'
           else 'other' end unit_family
    from public.leaflet_import_items li
    join current_imports ci on ci.import_id=li.import_id
    join public.products p on p.id=li.product_id
    where li.product_id is not null and li.source_page is not null
  ), pages as (
    select let.import_id,(pg->>'page')::integer page,pg
    from public.leaflet_extracted_text let join current_imports ci on ci.import_id=let.import_id,
         lateral jsonb_array_elements(let.pages) pg
  ), name_tokens as (
    select i.*,tok,length(tok) len
    from items i,lateral regexp_split_to_table(public.normalize_text(i.name),' +') tok
    where length(tok)>=4
      and tok not in ('original','premium','protein','extra','classic','vybrane','druhy','smetanovy','damsky','ovocny','nebo','gold','selection','prolinie','prostredek','kapsicka','kapsicky','baleni','velky','vanilkovy','sada','tablety','napoj','napoje','ochuceny','ochucena','ochucene','mineralni','kusy','cena','nase')
  ), token_hits as (
    select nt.*,(w->>'x')::numeric x,(w->>'y')::numeric y,
           count(*) over(partition by nt.id,nt.tok) occurrences
    from name_tokens nt join pages pg on pg.import_id=nt.import_id and pg.page=nt.source_page
    cross join lateral jsonb_array_elements(pg.pg->'tokens') w
    where public.normalize_text(w->>'text')=nt.tok
  ), anchors as (
    select distinct on(id) id,import_id,product_id,source_page,name,quantity_text,filter_group,unit_family,tok,x,y
    from token_hits
    order by id,case when occurrences=1 then 0 else 1 end,len desc,tok
  ), neighbor_consensus as (
    select a.id,a.product_id,a.filter_group,a.unit_family,
           count(b.id)::integer neighbor_count,
           count(distinct b.filter_group)::integer group_count,
           min(b.filter_group) consensus_group
    from anchors a
    join anchors b on b.id<>a.id and b.import_id=a.import_id and b.source_page=a.source_page
                  and b.unit_family=a.unit_family and b.unit_family<>'other'
                  and abs(b.y-a.y)<=20
                  and b.filter_group is not null and b.filter_group<>'other'
    group by a.id,a.product_id,a.filter_group,a.unit_family
  )
  select count(*)::integer into v_conflicts
  from neighbor_consensus n
  where n.filter_group is not null and n.filter_group<>'other'
    and n.group_count=1 and n.consensus_group<>n.filter_group;

  if v_conflicts>0 then
    return jsonb_build_object('ok',false,'blocked',true,'reason','known_row_consensus_conflict','known_conflicts',v_conflicts,'marked',0);
  end if;

  with params as (select (now() at time zone 'Europe/Prague')::date d),
  current_imports as (
    select distinct (o.metadata->>'import_id')::uuid import_id
    from public.offers o join public.stores st on st.id=o.store_id cross join params x
    where st.slug='billa' and o.status='published' and o.is_verified=true
      and o.valid_from<=x.d and o.valid_to>=x.d
      and coalesce(o.metadata->>'import_id','') ~ '^[0-9a-f-]{36}$'
  ), items as (
    select li.id,li.import_id,li.product_id,li.source_page,li.quantity_text,p.name,p.filter_group,
      case when public.normalize_text(coalesce(li.quantity_text,'')) ~ '(^| )[0-9]+([,.][0-9]+)? *(g|kg)( |$)' then 'mass'
           when public.normalize_text(coalesce(li.quantity_text,'')) ~ '(^| )[0-9]+([,.][0-9]+)? *(ml|l)( |$)' then 'volume'
           when public.normalize_text(coalesce(li.quantity_text,'')) ~ '(^| )[0-9]+ *(ks|kus|kusu|davek|davka)( |$)' then 'count'
           else 'other' end unit_family
    from public.leaflet_import_items li
    join current_imports ci on ci.import_id=li.import_id
    join public.products p on p.id=li.product_id
    where li.product_id is not null and li.source_page is not null
  ), pages as (
    select let.import_id,(pg->>'page')::integer page,pg
    from public.leaflet_extracted_text let join current_imports ci on ci.import_id=let.import_id,
         lateral jsonb_array_elements(let.pages) pg
  ), name_tokens as (
    select i.*,tok,length(tok) len
    from items i,lateral regexp_split_to_table(public.normalize_text(i.name),' +') tok
    where length(tok)>=4
      and tok not in ('original','premium','protein','extra','classic','vybrane','druhy','smetanovy','damsky','ovocny','nebo','gold','selection','prolinie','prostredek','kapsicka','kapsicky','baleni','velky','vanilkovy','sada','tablety','napoj','napoje','ochuceny','ochucena','ochucene','mineralni','kusy','cena','nase')
  ), token_hits as (
    select nt.*,(w->>'x')::numeric x,(w->>'y')::numeric y,
           count(*) over(partition by nt.id,nt.tok) occurrences
    from name_tokens nt join pages pg on pg.import_id=nt.import_id and pg.page=nt.source_page
    cross join lateral jsonb_array_elements(pg.pg->'tokens') w
    where public.normalize_text(w->>'text')=nt.tok
  ), anchors as (
    select distinct on(id) id,import_id,product_id,source_page,name,quantity_text,filter_group,unit_family,tok,x,y
    from token_hits
    order by id,case when occurrences=1 then 0 else 1 end,len desc,tok
  ), neighbor_consensus as (
    select a.id,a.product_id,a.filter_group,a.unit_family,
           count(b.id)::integer neighbor_count,
           count(distinct b.filter_group)::integer group_count,
           min(b.filter_group) consensus_group
    from anchors a
    join anchors b on b.id<>a.id and b.import_id=a.import_id and b.source_page=a.source_page
                  and b.unit_family=a.unit_family and b.unit_family<>'other'
                  and abs(b.y-a.y)<=20
                  and b.filter_group is not null and b.filter_group<>'other'
    group by a.id,a.product_id,a.filter_group,a.unit_family
  ), eligible as (
    select distinct product_id,consensus_group,neighbor_count,unit_family
    from neighbor_consensus
    where coalesce(nullif(btrim(filter_group),''),'other')='other'
      and group_count=1 and neighbor_count>=1
      and consensus_group in ('food','drinks','drugstore','home','garden','electronics','fashion','school','toys','pets','sports','auto','pharmacy')
  )
  update public.products p
     set metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object(
       'source_page_consensus_version','88',
       'source_page_consensus_group',e.consensus_group,
       'source_page_consensus_source','billa-unit-compatible-row-v88',
       'source_page_consensus_neighbor_count',e.neighbor_count,
       'source_page_consensus_unit_family',e.unit_family,
       'source_page_consensus_checked_at',now()
     )
    from eligible e
   where p.id=e.product_id and coalesce(p.metadata->>'filter_group_source','')<>'explicit';
  get diagnostics v_marked=row_count;

  return jsonb_build_object('ok',true,'blocked',false,'known_conflicts',v_conflicts,'marked',v_marked);
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable parallel safe
set search_path to 'public','pg_temp'
as $function$ select 88 $function$;

do $do$
declare v_def text;
begin
  v_def:=pg_get_functiondef('public.auto_assign_product_filter_group()'::regprocedure);
  if position($needle$when 'billa' then 'source-page-consensus-v52'$needle$ in v_def)=0 then
    raise exception 'BILLA page consensus classification source block changed';
  end if;
  v_def:=replace(v_def,
    $old$when 'billa' then 'source-page-consensus-v52'$old$,
    $new$when 'billa' then case when coalesce(new.metadata->>'source_page_consensus_version','')='88' then 'source-row-consensus-v88' else 'source-page-consensus-v52' end$new$);
  execute v_def;
end
$do$;

select private.refresh_billa_unit_row_consensus_v88();
select cron.schedule('classify-billa-unit-row-consensus-v88','22 * * * *','select private.refresh_billa_unit_row_consensus_v88();');

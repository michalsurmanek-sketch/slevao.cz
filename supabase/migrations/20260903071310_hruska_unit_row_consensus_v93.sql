create or replace function private.refresh_hruska_unit_row_consensus_v93()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
set statement_timeout to '30s'
as $function$
declare v_conflicts integer:=0; v_marked integer:=0;
begin
  with today as (select (now() at time zone 'Europe/Prague')::date d),
  cur as (
    select distinct p.id,p.name,p.quantity_text,p.filter_group,p.classification_source,
           o.metadata->>'import_id' import_id,nullif(o.metadata->>'leaflet_page','')::int page_no,
           case when public.normalize_text(coalesce(p.quantity_text,'')) ~ '(g|kg)$' then 'mass'
                when public.normalize_text(coalesce(p.quantity_text,'')) ~ '(ml|l)$' then 'volume'
                when public.normalize_text(coalesce(p.quantity_text,'')) ~ 'ks$' then 'count' end unit_family
    from public.offers o join public.products p on p.id=o.product_id join public.stores s on s.id=o.store_id and s.slug='hruska' cross join today t
    where o.status='published' and o.is_verified=true and o.valid_from<=t.d and o.valid_to>=t.d and p.is_active=true
  ), src as (select import_id,pages from public.leaflet_extracted_text where import_id in (select distinct import_id::uuid from cur where import_id is not null)),
  toks as (select s.import_id,(page->>'page')::int page_no,(tok->>'y')::numeric y,tok->>'text' txt from src s cross join lateral jsonb_array_elements(s.pages) page cross join lateral jsonb_array_elements(page->'tokens') tok),
  anchored as (
    select c.*,(select t.y from toks t where t.import_id=c.import_id::uuid and t.page_no=c.page_no and length(trim(t.txt))>=4 and lower(split_part(c.name,' · ',1)) like '%'||lower(trim(t.txt))||'%' order by length(trim(t.txt)) desc,t.y desc limit 1) ay
    from cur c where c.page_no is not null and c.unit_family is not null
  ), predicted as (
    select a.id,a.filter_group,a.classification_source,count(distinct n.id)::int neighbor_count,count(distinct n.filter_group)::int group_count,min(n.filter_group) predicted_group
    from anchored a join anchored n on n.import_id=a.import_id and n.page_no=a.page_no and n.unit_family=a.unit_family and n.id<>a.id
      and n.ay is not null and a.ay is not null and abs(n.ay-a.ay)<=40
      and n.filter_group is not null and n.filter_group<>'other'
      and coalesce(n.classification_source,'')<>'source-row-consensus-v93'
    group by a.id,a.filter_group,a.classification_source
    having count(distinct n.id)>=1 and count(distinct n.filter_group)=1
  )
  select count(*) into v_conflicts from predicted where filter_group is not null and filter_group<>'other' and filter_group<>predicted_group;
  if v_conflicts>0 then return jsonb_build_object('ok',false,'blocked',true,'known_conflicts',v_conflicts); end if;

  with today as (select (now() at time zone 'Europe/Prague')::date d),
  cur as (
    select distinct p.id,p.name,p.quantity_text,p.filter_group,p.classification_source,
           o.metadata->>'import_id' import_id,nullif(o.metadata->>'leaflet_page','')::int page_no,
           case when public.normalize_text(coalesce(p.quantity_text,'')) ~ '(g|kg)$' then 'mass'
                when public.normalize_text(coalesce(p.quantity_text,'')) ~ '(ml|l)$' then 'volume'
                when public.normalize_text(coalesce(p.quantity_text,'')) ~ 'ks$' then 'count' end unit_family
    from public.offers o join public.products p on p.id=o.product_id join public.stores s on s.id=o.store_id and s.slug='hruska' cross join today t
    where o.status='published' and o.is_verified=true and o.valid_from<=t.d and o.valid_to>=t.d and p.is_active=true
  ), src as (select import_id,pages from public.leaflet_extracted_text where import_id in (select distinct import_id::uuid from cur where import_id is not null)),
  toks as (select s.import_id,(page->>'page')::int page_no,(tok->>'y')::numeric y,tok->>'text' txt from src s cross join lateral jsonb_array_elements(s.pages) page cross join lateral jsonb_array_elements(page->'tokens') tok),
  anchored as (
    select c.*,(select t.y from toks t where t.import_id=c.import_id::uuid and t.page_no=c.page_no and length(trim(t.txt))>=4 and lower(split_part(c.name,' · ',1)) like '%'||lower(trim(t.txt))||'%' order by length(trim(t.txt)) desc,t.y desc limit 1) ay
    from cur c where c.page_no is not null and c.unit_family is not null
  ), candidates as (
    select a.id,a.import_id,a.page_no,a.unit_family,count(distinct n.id)::int neighbor_count,count(distinct n.filter_group)::int group_count,min(n.filter_group) predicted_group
    from anchored a join anchored n on n.import_id=a.import_id and n.page_no=a.page_no and n.unit_family=a.unit_family and n.id<>a.id
      and n.ay is not null and a.ay is not null and abs(n.ay-a.ay)<=40
      and n.filter_group is not null and n.filter_group<>'other'
      and coalesce(n.classification_source,'')<>'source-row-consensus-v93'
    where coalesce(a.filter_group,'other')='other'
    group by a.id,a.import_id,a.page_no,a.unit_family
    having count(distinct n.id)>=1 and count(distinct n.filter_group)=1
  )
  update public.products p set metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object(
    'source_store_slug','hruska','source_page_consensus_group',c.predicted_group,'source_page_consensus_version','93',
    'source_row_consensus_unit_family',c.unit_family,'source_row_consensus_neighbor_count',c.neighbor_count,'source_row_consensus_checked_at',now())
  from candidates c where p.id=c.id;
  get diagnostics v_marked=row_count;
  return jsonb_build_object('ok',true,'blocked',false,'known_conflicts',0,'marked',v_marked);
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer language sql immutable parallel safe set search_path to 'public','pg_temp'
as $function$ select 93 $function$;

do $patch$
declare v_def text; v_new text;
begin
  v_def:=pg_get_functiondef('public.auto_assign_product_filter_group()'::regprocedure);
  v_new:=replace(v_def,
    $$when 'hruska' then case when coalesce(new.metadata->>'source_page_consensus_version','')='91' then 'source-column-descriptor-v91' else 'source-page-consensus-v43' end$$,
    $$when 'hruska' then case when coalesce(new.metadata->>'source_page_consensus_version','')='93' then 'source-row-consensus-v93' when coalesce(new.metadata->>'source_page_consensus_version','')='91' then 'source-column-descriptor-v91' else 'source-page-consensus-v43' end$$);
  if v_new=v_def then raise exception 'v93 classifier label patch failed'; end if;
  execute v_new;
end;
$patch$;

do $schedule$
declare r record;
begin
  for r in select jobid from cron.job where jobname='classify-hruska-unit-row-consensus-v93' loop perform cron.unschedule(r.jobid); end loop;
  perform cron.schedule('classify-hruska-unit-row-consensus-v93','20 * * * *','select private.refresh_hruska_unit_row_consensus_v93();');
end;
$schedule$;
create or replace function private.refresh_catalog_semantic_majority_consensus_v98()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
set statement_timeout to '30s'
as $function$
declare v_marked integer:=0;
begin
  with today as (select (now() at time zone 'Europe/Prague')::date d),
  unresolved as (
    select distinct p.id,p.name,p.quantity_text,
      (select tok from regexp_split_to_table(public.normalize_text(split_part(p.name,' · ',1)),' +') tok
       where length(tok)>=4 and tok not in ('original','premium','protein','extra','classic','vybrane','druhy','gold','selection','miracle','prolinie','prostredek','kapsicka','baleni','velky','vanilkovy','sada','tablety','napoj','napoje','kusy','cena') limit 1) anchor
    from public.offers o join public.products p on p.id=o.product_id cross join today t
    where o.status='published' and o.is_verified=true and o.valid_from<=t.d and o.valid_to>=t.d and p.is_active=true
      and coalesce(nullif(btrim(p.filter_group),''),'other')='other' and coalesce(p.metadata->>'filter_group_source','')<>'explicit'
      and nullif(btrim(p.quantity_text),'') is not null
  ), refs as (
    select p.id,p.name,p.filter_group,public.normalize_text(p.name) n,
      case
        when p.filter_group='food' and public.normalize_text(p.name) ~ '(oplatk|susenk|zmrzlin|cereali|kornout|rezy|tycink|krupk|jogurt|syr|polevk|testovin|chips|bonbon|cokolad)' then true
        when p.filter_group='drinks' and public.normalize_text(p.name) ~ '(kakaovy napoj|instantni napoj|kava|caj|pivo|lezak|vino|limonad|cola|energy|dzus|juice|sirup|aperitiv|vodka|rum|whisky|frizzante)' then true
        when p.filter_group='drugstore' and public.normalize_text(p.name) ~ '(sampon|mydlo|antiperspirant|odlakovac|tampon|vlozk|kapesnik|praci|myck|nadobi)' then true
        else false end semantic_type
    from public.products p
    where p.is_active=true and p.filter_group is not null and p.filter_group<>'other'
      and coalesce(p.classification_source,'') not like 'catalog-%consensus%'
      and coalesce(p.classification_source,'') not in ('source-row-consensus-v93','source-column-descriptor-v91')
  ), grouped as (
    select u.id,u.anchor,r.filter_group,count(distinct r.n)::int group_refs,count(distinct r.n) filter(where r.semantic_type)::int semantic_refs
    from unresolved u join refs r on u.anchor is not null and (' '||r.n||' ') like ('% '||u.anchor||' %') and r.id<>u.id
    group by u.id,u.anchor,r.filter_group
  ), stats as (
    select g.*,sum(group_refs) over(partition by id)::int total_refs,max(group_refs) over(partition by id)::int dominant_refs,
      row_number() over(partition by id order by group_refs desc,filter_group) rn
    from grouped g
  ), eligible as (
    select s.*,coalesce((select sum(g2.semantic_refs) from grouped g2 where g2.id=s.id and g2.filter_group<>s.filter_group),0)::int semantic_conflicts
    from stats s
    where rn=1 and total_refs>=5 and dominant_refs>=4 and group_refs::numeric/total_refs>=0.80 and semantic_refs>=3
      and filter_group in ('food','drinks','drugstore')
  )
  update public.products p
  set metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object(
    'source_catalog_consensus_version','98','source_catalog_consensus_group',e.filter_group,'source_catalog_consensus_anchor',e.anchor,
    'source_catalog_consensus_ref_count',e.group_refs,'source_catalog_consensus_total_ref_count',e.total_refs,
    'source_catalog_consensus_semantic_ref_count',e.semantic_refs,'source_catalog_consensus_semantic_conflicts',e.semantic_conflicts,
    'source_catalog_consensus_source','semantic-majority-family-v98','source_catalog_consensus_checked_at',now())
  from eligible e where p.id=e.id and e.semantic_conflicts=0;
  get diagnostics v_marked=row_count;
  return jsonb_build_object('ok',true,'marked',v_marked);
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer language sql immutable parallel safe set search_path to 'public','pg_temp'
as $function$ select 98 $function$;

do $patch$
declare v_def text; v_new text;
begin
  v_def:=pg_get_functiondef('public.auto_assign_product_filter_group()'::regprocedure);
  v_new:=replace(v_def,$$in ('70','74','76','87','96')$$,$$in ('70','74','76','87','96','98')$$);
  if v_new=v_def then raise exception 'v98 version-list patch failed'; end if;
  v_def:=v_new;
  v_new:=replace(v_def,
    $$case when coalesce(new.metadata->>'source_catalog_consensus_version','')='96' then 'catalog-semantic-family-consensus-v96'$$,
    $$case when coalesce(new.metadata->>'source_catalog_consensus_version','')='98' then 'catalog-semantic-majority-consensus-v98' when coalesce(new.metadata->>'source_catalog_consensus_version','')='96' then 'catalog-semantic-family-consensus-v96'$$);
  if v_new=v_def then raise exception 'v98 label patch failed'; end if;
  execute v_new;
end;
$patch$;

do $schedule$
declare r record;
begin
  for r in select jobid from cron.job where jobname='classify-catalog-semantic-majority-v98' loop perform cron.unschedule(r.jobid); end loop;
  perform cron.schedule('classify-catalog-semantic-majority-v98','38 * * * *','select private.refresh_catalog_semantic_majority_consensus_v98();');
end;
$schedule$;
create or replace function private.refresh_catalog_semantic_food_family_consensus_v96()
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
    select distinct p.id,p.name,p.quantity_text,public.normalize_text(split_part(p.name,' · ',1)) base
    from public.offers o join public.products p on p.id=o.product_id cross join today t
    where o.status='published' and o.is_verified=true and o.valid_from<=t.d and o.valid_to>=t.d and p.is_active=true
      and coalesce(nullif(btrim(p.filter_group),''),'other')='other' and coalesce(p.metadata->>'filter_group_source','')<>'explicit'
  ), toks as (
    select u.*,
      (select tok from regexp_split_to_table(u.base,' +') tok where length(tok)>=4 and tok not in ('original','premium','protein','extra','classic','vybrane','druhy','gold','selection','miracle','prolinie','prostredek','kapsicka','baleni','velky','vanilkovy','sada','tablety','napoj','napoje','kusy','cena') limit 1) a1,
      (select case when count(*)=2 then string_agg(tok,' ' order by ord) end from (select tok,ord from regexp_split_to_table(u.base,' +') with ordinality x(tok,ord) where length(tok)>=3 and tok not in ('original','premium','protein','extra','classic','vybrane','druhy','gold','selection','miracle','prolinie','prostredek','kapsicka','baleni','velky','vanilkovy','sada','tablety','napoj','napoje','kusy','cena') order by ord limit 2) z) a2
    from unresolved u
  ), refs as (
    select p.id,p.name,p.filter_group,public.normalize_text(p.name) n,
           public.normalize_text(p.name) ~ '(oplatk|susenk|zmrzlin|cereali|kornout|rezy|tycink|krupk)' food_type
    from public.products p
    where p.is_active=true and p.filter_group is not null and p.filter_group<>'other'
      and coalesce(p.classification_source,'') not like 'catalog-%consensus%'
      and coalesce(p.classification_source,'') not in ('source-row-consensus-v93','source-column-descriptor-v91')
  ), s1 as (
    select u.id,'token1'::text mode,u.a1 anchor,count(distinct r.n)::int unique_refs,count(distinct r.filter_group)::int group_count,min(r.filter_group) consensus_group,
      count(distinct r.n) filter(where r.food_type and r.filter_group='food')::int explicit_type_refs
    from toks u join refs r on u.a1 is not null and (' '||r.n||' ') like ('% '||u.a1||' %') and r.id<>u.id group by u.id,u.a1
  ), s2 as (
    select u.id,'token2'::text mode,u.a2 anchor,count(distinct r.n)::int unique_refs,count(distinct r.filter_group)::int group_count,min(r.filter_group) consensus_group,
      count(distinct r.n) filter(where r.food_type and r.filter_group='food')::int explicit_type_refs
    from toks u join refs r on u.a2 is not null and (' '||r.n||' ') like ('% '||u.a2||' %') and r.id<>u.id group by u.id,u.a2
  ), eligible as (
    select * from s1 where unique_refs>=5 and group_count=1 and consensus_group='food' and explicit_type_refs>=3
    union all
    select * from s2 where unique_refs>=3 and group_count=1 and consensus_group='food' and explicit_type_refs>=2
  ), chosen as (
    select distinct on(id) * from eligible order by id,case mode when 'token2' then 0 else 1 end,explicit_type_refs desc,unique_refs desc
  )
  update public.products p
  set metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object(
    'source_catalog_consensus_version','96','source_catalog_consensus_group','food','source_catalog_consensus_anchor',c.anchor,
    'source_catalog_consensus_mode',c.mode,'source_catalog_consensus_ref_count',c.unique_refs,'source_catalog_consensus_semantic_ref_count',c.explicit_type_refs,
    'source_catalog_consensus_source','semantic-type-bearing-family-v96','source_catalog_consensus_checked_at',now())
  from chosen c where p.id=c.id;
  get diagnostics v_marked=row_count;
  return jsonb_build_object('ok',true,'marked',v_marked);
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer language sql immutable parallel safe set search_path to 'public','pg_temp'
as $function$ select 96 $function$;

do $patch$
declare v_def text; v_new text;
begin
  v_def:=pg_get_functiondef('public.auto_assign_product_filter_group()'::regprocedure);
  v_new:=replace(v_def,$$in ('70','74','76','87')$$,$$in ('70','74','76','87','96')$$);
  if v_new=v_def then raise exception 'v96 version-list patch failed'; end if;
  v_def:=v_new;
  v_new:=replace(v_def,
    $$case when coalesce(new.metadata->>'source_catalog_consensus_version','')='87' then 'catalog-short-token-consensus-v87'$$,
    $$case when coalesce(new.metadata->>'source_catalog_consensus_version','')='96' then 'catalog-semantic-family-consensus-v96' when coalesce(new.metadata->>'source_catalog_consensus_version','')='87' then 'catalog-short-token-consensus-v87'$$);
  if v_new=v_def then raise exception 'v96 label patch failed'; end if;
  execute v_new;
end;
$patch$;

do $schedule$
declare r record;
begin
  for r in select jobid from cron.job where jobname='classify-catalog-semantic-food-family-v96' loop perform cron.unschedule(r.jobid); end loop;
  perform cron.schedule('classify-catalog-semantic-food-family-v96','36 * * * *','select private.refresh_catalog_semantic_food_family_consensus_v96();');
end;
$schedule$;
-- Quantity-compatible semantic catalog consensus.
-- This reconstructed file contains the final optimized refresh implementation
-- that production received in the following runtime migration.

create or replace function public.product_quantity_family_v99(p_quantity text)
returns text language sql immutable parallel safe set search_path to 'public','pg_temp'
as $function$
select case
  when lower(coalesce(p_quantity,'')) ~ '(^|[^a-z])(kg|g)([^a-z]|$)' then 'mass'
  when lower(coalesce(p_quantity,'')) ~ '(^|[^a-z])(ml|l)([^a-z]|$)' then 'volume'
  when lower(coalesce(p_quantity,'')) ~ '(^|[^a-z])(ks|kus|kusy)([^a-z]|$)' then 'count'
  else null end
$function$;

create or replace function public.product_quantity_values_base_v99(p_quantity text)
returns numeric[]
language plpgsql immutable parallel safe set search_path to 'public','pg_temp'
as $function$
declare v_q text:=lower(coalesce(p_quantity,'')); v_family text; v_values numeric[];
begin
  v_family:=public.product_quantity_family_v99(v_q); if v_family is null then return null; end if;
  v_q:=regexp_replace(v_q,'(^|[^0-9])([0-9]+)\s*[x×]\s*',E'\\1','g');
  select array_agg(replace(m[1],',','.')::numeric) into v_values from regexp_matches(v_q,'([0-9]+(?:[,.][0-9]+)?)','g') m;
  if v_values is null then return null; end if;
  if v_family='mass' and v_q ~ '(^|[^a-z])kg([^a-z]|$)' and v_q !~ '(^|[^a-z])g([^a-z]|$)' then
    select array_agg(case when x<20 then x*1000 else x end) into v_values from unnest(v_values) x;
  elsif v_family='volume' and v_q ~ '(^|[^a-z])l([^a-z]|$)' and v_q !~ '(^|[^a-z])ml([^a-z]|$)' then
    select array_agg(case when x<20 then x*1000 else x end) into v_values from unnest(v_values) x;
  end if;
  return v_values;
end;
$function$;

create or replace function public.product_quantities_overlap_v99(p_a text,p_b text)
returns boolean
language plpgsql immutable parallel safe set search_path to 'public','pg_temp'
as $function$
declare
  v_fa text:=public.product_quantity_family_v99(p_a); v_fb text:=public.product_quantity_family_v99(p_b);
  v_a numeric[]:=public.product_quantity_values_base_v99(p_a); v_b numeric[]:=public.product_quantity_values_base_v99(p_b);
begin
  if v_fa is null or v_fb is null or v_fa<>v_fb or v_a is null or v_b is null then return false; end if;
  return exists(select 1 from unnest(v_a) a cross join unnest(v_b) b where abs(a-b)<=greatest(1::numeric,0.03*greatest(a,b)));
end;
$function$;

create or replace function public.product_family_anchor_v99(p_name text)
returns text language sql immutable parallel safe set search_path to 'public','pg_temp'
as $function$
with n as (select public.normalize_text(split_part(coalesce(p_name,''),' · ',1)) v)
select tok from n,regexp_split_to_table(n.v,' +') with ordinality x(tok,ord)
where length(tok)>=4 and tok !~ '^[0-9]+$'
  and tok not in ('original','extra','premium','protein','classic','selection','vybrane','druhy','velky','maly','white','black','gold','plus','mini','maxi','active','fresh','natural','baleni','kapsicka','prostredek','tablety','napoj','napoje','kusy','cena')
order by ord limit 1
$function$;

create or replace function private.refresh_catalog_quantity_semantic_consensus_v99()
returns jsonb
language plpgsql security definer set search_path to 'public','private','pg_temp' set statement_timeout to '20s'
as $function$
declare v_marked integer:=0;
begin
  with today as (select (now() at time zone 'Europe/Prague')::date d),
  unresolved as (
    select distinct p.id,p.name,p.quantity_text,public.product_family_anchor_v99(p.name) anchor
    from public.offers o join public.products p on p.id=o.product_id cross join today t
    where o.status='published' and o.is_verified=true and o.valid_from<=t.d and o.valid_to>=t.d
      and p.is_active=true and coalesce(nullif(btrim(p.filter_group),''),'other')='other'
      and coalesce(p.metadata->>'filter_group_source','')<>'explicit' and nullif(btrim(p.quantity_text),'') is not null
  ), anchors as (select distinct anchor from unresolved where anchor is not null),
  refs as (
    select distinct p.id,p.name,p.quantity_text,p.filter_group,a.anchor,
      case when p.filter_group='food' and public.normalize_text(p.name) ~ '(krupky|tycinka|cokolad|mrazeny krem|zmrzlin|oplatk|susenk|bonbon|chips|krekry|cereali|kornout|rezy|jogurt|syr|pomazank|pecivo|chleb|sunka|salam|klobas|parky)' then true else false end explicit_food_type
    from public.products p
    join lateral regexp_split_to_table(public.normalize_text(p.name),' +') tok on true
    join anchors a on a.anchor=tok
    where p.is_active=true and p.filter_group is not null and p.filter_group<>'other'
      and coalesce(p.classification_source,'') not like 'catalog-%consensus%'
      and coalesce(p.metadata->>'filter_group_source','')<>'catalog_consensus'
  ), compatible as (
    select u.id,u.anchor,r.id ref_id,r.filter_group,r.explicit_food_type
    from unresolved u join refs r on r.anchor=u.anchor and r.id<>u.id
    where public.product_quantities_overlap_v99(u.quantity_text,r.quantity_text)
  ), stats as (
    select id,anchor,count(distinct ref_id)::int ref_count,count(distinct filter_group)::int group_count,min(filter_group) consensus_group,
      count(distinct ref_id) filter(where filter_group='food' and explicit_food_type)::int semantic_ref_count
    from compatible group by id,anchor
  ), eligible as (
    select * from stats where ref_count>=1 and group_count=1 and consensus_group='food' and semantic_ref_count>=1
  )
  update public.products p
  set metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object(
    'source_catalog_consensus_version','99','source_catalog_consensus_group','food','source_catalog_consensus_anchor',e.anchor,
    'source_catalog_consensus_ref_count',e.ref_count,'source_catalog_consensus_semantic_ref_count',e.semantic_ref_count,
    'source_catalog_consensus_source','quantity-compatible-semantic-family-v99','source_catalog_consensus_checked_at',now())
  from eligible e where p.id=e.id;
  get diagnostics v_marked=row_count;
  return jsonb_build_object('ok',true,'marked',v_marked);
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer language sql immutable parallel safe set search_path to 'public','pg_temp'
as $function$ select 99 $function$;

do $patch$
declare v_def text; v_new text;
begin
  v_def:=pg_get_functiondef('public.auto_assign_product_filter_group()'::regprocedure);
  v_new:=replace(v_def,$$in ('70','74','76','87','96','98')$$,$$in ('70','74','76','87','96','98','99')$$);
  if v_new=v_def then raise exception 'v99 version-list patch failed'; end if;
  v_def:=v_new;
  v_new:=replace(v_def,
    $$case when coalesce(new.metadata->>'source_catalog_consensus_version','')='98' then 'catalog-semantic-majority-consensus-v98'$$,
    $$case when coalesce(new.metadata->>'source_catalog_consensus_version','')='99' then 'catalog-quantity-semantic-consensus-v99' when coalesce(new.metadata->>'source_catalog_consensus_version','')='98' then 'catalog-semantic-majority-consensus-v98'$$);
  if v_new=v_def then raise exception 'v99 label patch failed'; end if;
  execute v_new;
end;
$patch$;

do $schedule$
declare r record;
begin
  for r in select jobid from cron.job where jobname='classify-catalog-quantity-semantic-v99' loop perform cron.unschedule(r.jobid); end loop;
  perform cron.schedule('classify-catalog-quantity-semantic-v99','40 * * * *','select private.refresh_catalog_quantity_semantic_consensus_v99();');
end;
$schedule$;
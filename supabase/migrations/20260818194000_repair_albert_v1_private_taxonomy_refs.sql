select pg_advisory_xact_lock(hashtextextended('slevao:albert-publitas-v4', 0));

create temporary table _albert_v1_private_map on commit drop as
select p.id as duplicate_id,
       (p.metadata->>'_duplicate_canonical_product_id')::uuid as canonical_id
from public.products p
where p.is_active=false
  and p.metadata->>'_duplicate_deactivation_policy'='albert_v4_branded_single_alias_v1'
  and nullif(p.metadata->>'_duplicate_canonical_product_id','') is not null;

do $guard$
declare
  v_candidates integer;
  v_logs integer;
  v_visual integer;
  v_inactive_canonicals integer;
begin
  select count(*) into v_candidates
  from private.product_taxonomy_candidates x
  join _albert_v1_private_map m on m.duplicate_id=x.product_id;

  select count(*) into v_logs
  from private.product_taxonomy_backfill_log x
  join _albert_v1_private_map m on m.duplicate_id=x.product_id;

  select count(*) into v_visual
  from private.offer_visual_fallback_candidates x
  join _albert_v1_private_map m on m.duplicate_id=x.product_id;

  select count(*) into v_inactive_canonicals
  from _albert_v1_private_map m
  left join public.products p on p.id=m.canonical_id and p.is_active=true
  where p.id is null;

  if not (v_candidates = 0 and v_logs = 0 and v_visual = 0 and v_inactive_canonicals = 0)
     and (v_candidates <> 9 or v_logs <> 2 or v_visual <> 0 or v_inactive_canonicals <> 0) then
    raise exception 'Albert v1 private-ref repair drifted: candidates=%, logs=%, visual=%, inactive canonicals=%; expected 9,2,0,0.',
      v_candidates,v_logs,v_visual,v_inactive_canonicals;
  end if;
end
$guard$;

create temporary table _taxonomy_candidate_rank on commit drop as
select x.product_id as duplicate_id,
       m.canonical_id,
       row_number() over (
         partition by m.canonical_id
         order by x.confidence desc nulls last, x.generated_at desc nulls last, x.product_id
       ) as rn
from private.product_taxonomy_candidates x
join _albert_v1_private_map m on m.duplicate_id=x.product_id;

do $guard$
declare v_conflicts integer;
begin
  select count(*) into v_conflicts
  from (select distinct canonical_id from _taxonomy_candidate_rank) r
  join private.product_taxonomy_candidates x on x.product_id=r.canonical_id;
  if v_conflicts <> 0 then
    raise exception 'Albert v1 taxonomy-candidate repair found % existing canonical conflicts.',v_conflicts;
  end if;
end
$guard$;

delete from private.product_taxonomy_candidates x
using _taxonomy_candidate_rank r
where x.product_id=r.duplicate_id and r.rn>1;

update private.product_taxonomy_candidates x
set product_id=r.canonical_id
from _taxonomy_candidate_rank r
where x.product_id=r.duplicate_id and r.rn=1;

create temporary table _taxonomy_log_rank on commit drop as
select x.run_id,
       x.product_id as duplicate_id,
       m.canonical_id,
       row_number() over (
         partition by x.run_id,m.canonical_id
         order by x.applied_at desc nulls last,x.product_id
       ) as rn
from private.product_taxonomy_backfill_log x
join _albert_v1_private_map m on m.duplicate_id=x.product_id;

do $guard$
declare v_conflicts integer;
begin
  select count(*) into v_conflicts
  from (select distinct run_id,canonical_id from _taxonomy_log_rank) r
  join private.product_taxonomy_backfill_log x
    on x.run_id=r.run_id and x.product_id=r.canonical_id;
  if v_conflicts <> 0 then
    raise exception 'Albert v1 taxonomy-log repair found % existing canonical conflicts.',v_conflicts;
  end if;
end
$guard$;

delete from private.product_taxonomy_backfill_log x
using _taxonomy_log_rank r
where x.run_id=r.run_id and x.product_id=r.duplicate_id and r.rn>1;

update private.product_taxonomy_backfill_log x
set product_id=r.canonical_id
from _taxonomy_log_rank r
where x.run_id=r.run_id and x.product_id=r.duplicate_id and r.rn=1;

create table if not exists private.product_taxonomy_backfill_log (
  run_id uuid not null,
  product_id uuid not null references public.products(id) on delete cascade,
  previous_category_id uuid,
  previous_filter_group text,
  previous_filter_tags text[],
  previous_confidence numeric,
  previous_source text,
  applied_category_id uuid,
  applied_filter_group text,
  applied_filter_tags text[],
  applied_confidence numeric,
  applied_source text,
  applied_at timestamptz not null default now(),
  primary key (run_id, product_id)
);

revoke all on table private.product_taxonomy_backfill_log from public, anon, authenticated;
grant select, insert, update, delete on table private.product_taxonomy_backfill_log to service_role;

create or replace function private.apply_product_taxonomy_candidates(
  p_limit integer default 100,
  p_min_confidence numeric default 0.99
)
returns table(run_id uuid, applied_count integer)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_run_id uuid := gen_random_uuid();
  v_count integer := 0;
begin
  if p_limit < 1 or p_limit > 500 then
    raise exception 'p_limit must be between 1 and 500';
  end if;
  if p_min_confidence < 0.96 or p_min_confidence > 1 then
    raise exception 'p_min_confidence must be between 0.96 and 1';
  end if;

  with candidates as (
    select c.*, cat.id as target_category_id
    from private.product_taxonomy_candidates c
    join public.categories cat on cat.slug = c.category_slug and cat.is_active is true
    join public.products p on p.id = c.product_id
    where c.confidence >= p_min_confidence
      and p.category_id is null
      and p.filter_group is null
      and coalesce(array_length(p.filter_tags,1),0) = 0
      and p.classification_confidence is null
    order by c.confidence desc, c.product_id
    limit p_limit
  ), logged as (
    insert into private.product_taxonomy_backfill_log(
      run_id, product_id,
      previous_category_id, previous_filter_group, previous_filter_tags, previous_confidence, previous_source,
      applied_category_id, applied_filter_group, applied_filter_tags, applied_confidence, applied_source
    )
    select
      v_run_id, p.id,
      p.category_id, p.filter_group, p.filter_tags, p.classification_confidence, p.classification_source,
      c.target_category_id, c.filter_group, c.filter_tags, c.confidence, c.source
    from candidates c
    join public.products p on p.id = c.product_id
    returning product_id, applied_category_id, applied_filter_group, applied_filter_tags, applied_confidence, applied_source
  )
  update public.products p
  set category_id = l.applied_category_id,
      filter_group = l.applied_filter_group,
      filter_tags = l.applied_filter_tags,
      classification_confidence = l.applied_confidence,
      classification_source = l.applied_source,
      classified_at = now(),
      updated_at = now()
  from logged l
  where p.id = l.product_id;

  get diagnostics v_count = row_count;
  return query select v_run_id, v_count;
end;
$$;

create or replace function private.rollback_product_taxonomy_backfill(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare v_count integer;
begin
  update public.products p
  set category_id = l.previous_category_id,
      filter_group = l.previous_filter_group,
      filter_tags = l.previous_filter_tags,
      classification_confidence = l.previous_confidence,
      classification_source = l.previous_source,
      classified_at = null,
      updated_at = now()
  from private.product_taxonomy_backfill_log l
  where l.run_id = p_run_id
    and p.id = l.product_id
    and p.category_id is not distinct from l.applied_category_id
    and p.filter_group is not distinct from l.applied_filter_group
    and p.filter_tags is not distinct from l.applied_filter_tags
    and p.classification_confidence is not distinct from l.applied_confidence
    and p.classification_source is not distinct from l.applied_source;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function private.apply_product_taxonomy_candidates(integer,numeric) from public, anon, authenticated;
revoke all on function private.rollback_product_taxonomy_backfill(uuid) from public, anon, authenticated;
grant execute on function private.apply_product_taxonomy_candidates(integer,numeric) to service_role;
grant execute on function private.rollback_product_taxonomy_backfill(uuid) to service_role;

comment on function private.apply_product_taxonomy_candidates(integer,numeric) is
  'Guarded batched taxonomy backfill. Only fills previously empty classification fields and logs every change for rollback.';
comment on function private.rollback_product_taxonomy_backfill(uuid) is
  'Rolls back one taxonomy backfill run only when current values still match what that run applied.';
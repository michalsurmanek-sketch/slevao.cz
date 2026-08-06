create table if not exists public.offer_bulk_reset_runs (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid null,
  created_at timestamptz not null default now(),
  restored_at timestamptz null,
  moved_count integer not null default 0,
  restored_count integer not null default 0,
  status text not null default 'pending' check (status in ('pending','partial','completed'))
);

alter table public.offer_bulk_reset_runs enable row level security;
revoke all on public.offer_bulk_reset_runs from anon, authenticated;

create or replace function public.start_offer_bulk_reset(p_requested_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  reset_id uuid := gen_random_uuid();
  affected integer := 0;
begin
  insert into public.offer_bulk_reset_runs(id, requested_by)
  values (reset_id, p_requested_by);

  update public.offers
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        '_bulk_reset_run_id', reset_id::text,
        '_bulk_reset_previous_status', status,
        '_bulk_reset_requested_at', now()
      ),
      status = 'trash',
      updated_at = now()
  where status <> 'trash';

  get diagnostics affected = row_count;

  update public.offer_bulk_reset_runs
  set moved_count = affected,
      status = case when affected = 0 then 'completed' else 'pending' end,
      restored_at = case when affected = 0 then now() else null end
  where id = reset_id;

  return jsonb_build_object(
    'ok', true,
    'reset_batch_id', reset_id,
    'moved_to_trash', affected
  );
end;
$$;

create or replace function public.restore_offer_bulk_reset(p_store_slugs text[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer := 0;
  touched_runs uuid[] := array[]::uuid[];
begin
  with candidates as materialized (
    select
      o.id,
      (o.metadata ->> '_bulk_reset_run_id')::uuid as run_id,
      case
        when o.valid_to < current_date
             and o.metadata ->> '_bulk_reset_previous_status' = 'published'
          then 'expired'
        when o.metadata ->> '_bulk_reset_previous_status' in
             ('draft','review','published','expired','rejected','error')
          then o.metadata ->> '_bulk_reset_previous_status'
        else 'draft'
      end as restore_status
    from public.offers o
    join public.stores s on s.id = o.store_id
    where o.status = 'trash'
      and o.metadata ? '_bulk_reset_run_id'
      and o.metadata ? '_bulk_reset_previous_status'
      and (p_store_slugs is null or s.slug = any(p_store_slugs))
  ), restored as (
    update public.offers o
    set status = c.restore_status,
        metadata = (
          o.metadata
          - '_bulk_reset_run_id'
          - '_bulk_reset_previous_status'
          - '_bulk_reset_requested_at'
        ) || jsonb_build_object('_bulk_reset_restored_at', now()),
        published_at = case
          when c.restore_status = 'published' then coalesce(o.published_at, now())
          else o.published_at
        end,
        updated_at = now()
    from candidates c
    where o.id = c.id
    returning c.run_id
  ), counts as (
    select run_id, count(*)::integer as restored_count
    from restored
    group by run_id
  ), updated_runs as (
    update public.offer_bulk_reset_runs r
    set restored_count = r.restored_count + c.restored_count
    from counts c
    where r.id = c.run_id
    returning r.id
  )
  select
    coalesce(sum(c.restored_count), 0)::integer,
    coalesce(array_agg(c.run_id), array[]::uuid[])
  into affected, touched_runs
  from counts c;

  update public.offer_bulk_reset_runs r
  set status = case
        when exists (
          select 1
          from public.offers o
          where o.status = 'trash'
            and o.metadata ->> '_bulk_reset_run_id' = r.id::text
        ) then 'partial'
        else 'completed'
      end,
      restored_at = case
        when exists (
          select 1
          from public.offers o
          where o.status = 'trash'
            and o.metadata ->> '_bulk_reset_run_id' = r.id::text
        ) then r.restored_at
        else coalesce(r.restored_at, now())
      end
  where r.id = any(touched_runs);

  return jsonb_build_object(
    'ok', true,
    'restored_offers', affected,
    'verified_stores', coalesce(to_jsonb(p_store_slugs), 'null'::jsonb)
  );
end;
$$;

revoke all on function public.start_offer_bulk_reset(uuid) from public, anon, authenticated;
revoke all on function public.restore_offer_bulk_reset(text[]) from public, anon, authenticated;
grant execute on function public.start_offer_bulk_reset(uuid) to service_role;
grant execute on function public.restore_offer_bulk_reset(text[]) to service_role;

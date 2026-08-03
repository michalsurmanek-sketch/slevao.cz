-- Slevao.cz: bezpečný koš nabídek a audit administrace
-- Migrace je idempotentní a zachovává existující data.

alter table public.offers
  add column if not exists previous_status text,
  add column if not exists trashed_at timestamptz,
  add column if not exists trashed_by uuid references auth.users(id) on delete set null;

-- Starší databáze mohou mít CHECK omezení bez hodnoty "trash".
do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.offers'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.offers drop constraint %I', constraint_row.conname);
  end loop;
end
$$;

alter table public.offers
  add constraint offers_status_check
  check (status in ('published', 'draft', 'review', 'expired', 'trash')) not valid;

alter table public.offers validate constraint offers_status_check;

create index if not exists offers_status_validity_idx
  on public.offers(status, valid_to desc);

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx
  on public.admin_audit_log(created_at desc);
create index if not exists admin_audit_log_entity_idx
  on public.admin_audit_log(entity_type, entity_id);

alter table public.admin_audit_log enable row level security;

drop policy if exists "staff read admin audit log" on public.admin_audit_log;
create policy "staff read admin audit log"
on public.admin_audit_log for select
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'editor'));

drop policy if exists "staff insert admin audit log" on public.admin_audit_log;
create policy "staff insert admin audit log"
on public.admin_audit_log for insert
to authenticated
with check ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'editor'));

create or replace function public.admin_trash_offer(target_offer_id uuid)
returns public.offers
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  before_row public.offers;
  after_row public.offers;
begin
  if current_role not in ('admin', 'editor') then
    raise exception 'Nedostatečné oprávnění.' using errcode = '42501';
  end if;

  select * into before_row
  from public.offers
  where id = target_offer_id
  for update;

  if before_row.id is null then
    raise exception 'Nabídka neexistuje.' using errcode = 'P0002';
  end if;

  if before_row.status = 'trash' then
    return before_row;
  end if;

  update public.offers
  set previous_status = coalesce(nullif(before_row.status, 'trash'), 'review'),
      status = 'trash',
      published_at = null,
      trashed_at = now(),
      trashed_by = auth.uid()
  where id = target_offer_id
  returning * into after_row;

  insert into public.admin_audit_log(
    actor_id, actor_email, action, entity_type, entity_id, before_data, after_data
  ) values (
    auth.uid(), auth.jwt() ->> 'email', 'offer_trash', 'offer', target_offer_id,
    to_jsonb(before_row), to_jsonb(after_row)
  );

  return after_row;
end;
$$;

create or replace function public.admin_restore_offer(target_offer_id uuid)
returns public.offers
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  before_row public.offers;
  after_row public.offers;
  restore_status text;
begin
  if current_role not in ('admin', 'editor') then
    raise exception 'Nedostatečné oprávnění.' using errcode = '42501';
  end if;

  select * into before_row
  from public.offers
  where id = target_offer_id
  for update;

  if before_row.id is null then
    raise exception 'Nabídka neexistuje.' using errcode = 'P0002';
  end if;

  restore_status := case
    when before_row.previous_status in ('published', 'draft', 'review', 'expired') then before_row.previous_status
    when before_row.valid_to is not null and before_row.valid_to < current_date then 'expired'
    else 'review'
  end;

  if restore_status = 'published' and before_row.valid_to < current_date then
    restore_status := 'expired';
  end if;

  update public.offers
  set status = restore_status,
      published_at = case when restore_status = 'published' then coalesce(before_row.published_at, now()) else null end,
      previous_status = null,
      trashed_at = null,
      trashed_by = null
  where id = target_offer_id
  returning * into after_row;

  insert into public.admin_audit_log(
    actor_id, actor_email, action, entity_type, entity_id, before_data, after_data
  ) values (
    auth.uid(), auth.jwt() ->> 'email', 'offer_restore', 'offer', target_offer_id,
    to_jsonb(before_row), to_jsonb(after_row)
  );

  return after_row;
end;
$$;

grant execute on function public.admin_trash_offer(uuid) to authenticated;
grant execute on function public.admin_restore_offer(uuid) to authenticated;

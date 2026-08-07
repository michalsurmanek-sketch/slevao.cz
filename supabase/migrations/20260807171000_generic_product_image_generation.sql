-- Slevao.cz: oddělena fronta pro generování fotografií pouze u neznačkových produktů.
-- Existující vyhledávání, kandidátní fronta a knihovna fotografií zůstávají zachované.

create table if not exists public.product_image_generation_runs (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid references auth.users(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued','processing','completed','failed')),
  requested_count integer not null default 0 check (requested_count >= 0),
  processed_count integer not null default 0 check (processed_count >= 0),
  assigned_count integer not null default 0 check (assigned_count >= 0),
  manual_count integer not null default 0 check (manual_count >= 0),
  skipped_branded_count integer not null default 0 check (skipped_branded_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  message text,
  verification jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists product_image_generation_runs_created_idx
  on public.product_image_generation_runs(created_at desc);
create index if not exists product_image_generation_runs_requested_by_idx
  on public.product_image_generation_runs(requested_by)
  where requested_by is not null;

create table if not exists public.product_image_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.product_image_generation_runs(id) on delete set null,
  product_id uuid not null references public.products(id) on delete cascade,
  status text not null default 'missing_image'
    check (status in (
      'missing_image','queued_for_generation','generating','generated','assigned',
      'needs_manual_review','skipped_branded','failed'
    )),
  classification text
    check (classification is null or classification in (
      'unbranded_generic','branded','ambiguous','specific_packaged'
    )),
  normalized_name text,
  product_type text,
  variant text,
  quantity_text text,
  reason text,
  prompt text,
  image_url text,
  image_hash text,
  candidate_id uuid references public.product_image_candidates(id) on delete set null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  generated_at timestamptz,
  assigned_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(product_id)
);

create index if not exists product_image_generation_jobs_status_idx
  on public.product_image_generation_jobs(status, updated_at desc);
create index if not exists product_image_generation_jobs_run_idx
  on public.product_image_generation_jobs(run_id, status);
create index if not exists product_image_generation_jobs_candidate_idx
  on public.product_image_generation_jobs(candidate_id)
  where candidate_id is not null;
create index if not exists product_image_generation_jobs_hash_idx
  on public.product_image_generation_jobs(image_hash)
  where image_hash is not null and image_hash <> '';

create or replace function public.touch_product_image_generation_row()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists product_image_generation_runs_touch_trigger on public.product_image_generation_runs;
create trigger product_image_generation_runs_touch_trigger
before update on public.product_image_generation_runs
for each row execute function public.touch_product_image_generation_row();

drop trigger if exists product_image_generation_jobs_touch_trigger on public.product_image_generation_jobs;
create trigger product_image_generation_jobs_touch_trigger
before update on public.product_image_generation_jobs
for each row execute function public.touch_product_image_generation_row();

alter table public.product_image_generation_runs enable row level security;
alter table public.product_image_generation_jobs enable row level security;

revoke all on public.product_image_generation_runs from anon;
revoke all on public.product_image_generation_jobs from anon;
revoke all on public.product_image_generation_runs from authenticated;
revoke all on public.product_image_generation_jobs from authenticated;
grant select on public.product_image_generation_runs to authenticated;
grant select on public.product_image_generation_jobs to authenticated;

drop policy if exists product_image_generation_runs_staff_select on public.product_image_generation_runs;
create policy product_image_generation_runs_staff_select
on public.product_image_generation_runs
for select
to authenticated
using ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor'));

drop policy if exists product_image_generation_jobs_staff_select on public.product_image_generation_jobs;
create policy product_image_generation_jobs_staff_select
on public.product_image_generation_jobs
for select
to authenticated
using ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor'));

-- Stávající pravidlo ručního schválení zůstává výchozí.
-- Bez správce se smí schválit jen náš vlastní generovaný kandidát, který prošel
-- konzervativní klasifikací a přísnou vizuální kontrolou.
create or replace function public.require_manual_product_image_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  reviewer uuid;
  is_safe_generated boolean;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  is_safe_generated :=
    new.status = 'approved'
    and coalesce(new.metadata ->> 'generation_workflow', '') = 'unbranded_v1'
    and lower(coalesce(new.metadata ->> 'auto_approved', 'false')) = 'true'
    and coalesce(new.has_clean_background, false) = true
    and coalesce(new.has_text_overlay, false) = false
    and coalesce(new.has_price_overlay, false) = false
    and coalesce(new.quality_score, 0) >= 80
    and coalesce(new.match_score, 0) >= 0.90;

  if new.status in ('approved','rejected','invalid') then
    reviewer := coalesce(new.reviewed_by, auth.uid());

    if new.status = 'approved' and reviewer is null and not is_safe_generated then
      raise exception 'Automatické schválení fotografie není povoleno. Kandidáta musí schválit přihlášený správce.';
    end if;

    new.reviewed_by := reviewer;
    new.reviewed_at := coalesce(new.reviewed_at, now());
  elsif new.status = 'pending' then
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.rejection_reason := null;
  end if;

  return new;
end;
$$;

-- Funkce je triggerová interní logika, ne veřejné RPC.
revoke execute on function public.require_manual_product_image_review() from public, anon, authenticated;

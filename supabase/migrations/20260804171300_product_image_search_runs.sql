create table if not exists public.product_image_search_runs (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid null,
  store_slug text null,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  requested_count integer not null default 0,
  processed_count integer not null default 0,
  created_count integer not null default 0,
  rejected_count integer not null default 0,
  error_count integer not null default 0,
  message text null,
  results jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz null,
  finished_at timestamptz null,
  updated_at timestamptz not null default now()
);

create index if not exists product_image_search_runs_created_idx
  on public.product_image_search_runs (created_at desc);

alter table public.product_image_search_runs enable row level security;

drop policy if exists product_image_search_runs_staff_select on public.product_image_search_runs;
create policy product_image_search_runs_staff_select
on public.product_image_search_runs
for select
to authenticated
using ((auth.jwt()->'app_metadata'->>'role') in ('admin','editor'));

revoke all on public.product_image_search_runs from anon;
grant select on public.product_image_search_runs to authenticated;
-- Slevao.cz: automatický sběr a zpracování letáků
create extension if not exists pgcrypto;

create table if not exists public.leaflet_sources (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores(id) on delete cascade,
  name text not null,
  source_url text not null,
  source_type text not null default 'html' check (source_type in ('html','pdf','json')),
  pdf_selector text,
  is_active boolean not null default true,
  auto_publish boolean not null default false,
  check_interval_minutes integer not null default 360,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists leaflet_sources_url_uidx on public.leaflet_sources(source_url);

create table if not exists public.leaflet_imports (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.leaflet_sources(id) on delete set null,
  store_id uuid references public.stores(id) on delete set null,
  source_document_url text not null,
  source_hash text not null,
  status text not null default 'queued' check (status in ('queued','downloading','processing','review','publishing','published','failed','ignored')),
  detected_valid_from date,
  detected_valid_to date,
  page_count integer,
  product_count integer not null default 0,
  confidence numeric(5,4),
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists leaflet_imports_source_hash_uidx on public.leaflet_imports(source_hash);
create index if not exists leaflet_imports_status_idx on public.leaflet_imports(status, created_at desc);

create table if not exists public.leaflet_import_items (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.leaflet_imports(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  title text not null,
  brand text,
  quantity_text text,
  price numeric(12,2),
  old_price numeric(12,2),
  unit_price numeric(12,2),
  unit_label text,
  image_url text,
  source_page integer,
  confidence numeric(5,4),
  status text not null default 'review',
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Udrží migraci opakovatelnou a dovolí stav ignored používaný při přeskočení duplicit.
alter table public.leaflet_import_items drop constraint if exists leaflet_import_items_status_check;
alter table public.leaflet_import_items add constraint leaflet_import_items_status_check
  check (status in ('review','approved','rejected','published','failed','ignored'));

create index if not exists leaflet_import_items_import_idx on public.leaflet_import_items(import_id, status);

alter table public.leaflet_sources enable row level security;
alter table public.leaflet_imports enable row level security;
alter table public.leaflet_import_items enable row level security;

-- PostgreSQL nemá CREATE POLICY IF NOT EXISTS, proto je nejdříve bezpečně odstraníme.
drop policy if exists "staff read leaflet sources" on public.leaflet_sources;
drop policy if exists "staff manage leaflet sources" on public.leaflet_sources;
drop policy if exists "staff read leaflet imports" on public.leaflet_imports;
drop policy if exists "staff manage leaflet imports" on public.leaflet_imports;
drop policy if exists "staff read leaflet items" on public.leaflet_import_items;
drop policy if exists "staff manage leaflet items" on public.leaflet_import_items;

-- Přístup pro přihlášené administrátory/editory. Service role RLS obchází.
create policy "staff read leaflet sources" on public.leaflet_sources for select to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor'));
create policy "staff manage leaflet sources" on public.leaflet_sources for all to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor')) with check ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor'));
create policy "staff read leaflet imports" on public.leaflet_imports for select to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor'));
create policy "staff manage leaflet imports" on public.leaflet_imports for all to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor')) with check ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor'));
create policy "staff read leaflet items" on public.leaflet_import_items for select to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor'));
create policy "staff manage leaflet items" on public.leaflet_import_items for all to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor')) with check ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor'));

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists leaflet_sources_touch on public.leaflet_sources;
create trigger leaflet_sources_touch before update on public.leaflet_sources for each row execute function public.touch_updated_at();
drop trigger if exists leaflet_imports_touch on public.leaflet_imports;
create trigger leaflet_imports_touch before update on public.leaflet_imports for each row execute function public.touch_updated_at();
drop trigger if exists leaflet_import_items_touch on public.leaflet_import_items;
create trigger leaflet_import_items_touch before update on public.leaflet_import_items for each row execute function public.touch_updated_at();
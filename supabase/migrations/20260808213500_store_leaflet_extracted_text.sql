create table if not exists public.leaflet_extracted_text (
  import_id uuid primary key references public.leaflet_imports(id) on delete cascade,
  parser text not null,
  page_count integer not null default 0,
  text_content text not null default '',
  pages jsonb not null default '[]'::jsonb,
  text_chars integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.leaflet_extracted_text enable row level security;

revoke all on table public.leaflet_extracted_text from anon, authenticated;
grant all on table public.leaflet_extracted_text to service_role;

comment on table public.leaflet_extracted_text is
  'Private raw text extracted from leaflet documents for deterministic store-specific parsers.';
comment on column public.leaflet_extracted_text.pages is
  'Ordered JSON array of page objects with page number and extracted text lines.';

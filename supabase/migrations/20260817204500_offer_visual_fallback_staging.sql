create table if not exists private.offer_visual_fallback_candidates (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers(id) on delete cascade,
  product_id uuid null references public.products(id) on delete set null,
  store_id uuid not null references public.stores(id) on delete cascade,
  import_id uuid null references public.leaflet_imports(id) on delete set null,
  source_page integer not null,
  source_kind text not null check (source_kind in ('leaflet_offer_region','verified_product_photo')),
  page_image_url text not null,
  visual_url text not null,
  geometry jsonb not null default '{}'::jsonb,
  match_method text not null,
  match_confidence numeric not null check (match_confidence >= 0 and match_confidence <= 1),
  status text not null default 'pending' check (status in ('pending','approved','rejected','applied')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (offer_id, source_kind)
);

create index if not exists offer_visual_fallback_candidates_status_idx
  on private.offer_visual_fallback_candidates(status, store_id);

revoke all on private.offer_visual_fallback_candidates from public, anon, authenticated;
grant select, insert, update, delete on private.offer_visual_fallback_candidates to service_role;

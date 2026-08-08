-- Slevao.cz: internal pipeline state must not be exposed to anonymous clients.
-- Service-role Edge Functions bypass RLS. Admin/editor users keep controlled access.

alter table public.leaflet_adapter_registry enable row level security;
alter table public.leaflet_pipeline_runs enable row level security;
alter table public.leaflet_ocr_runs enable row level security;

-- Remove any accidentally inherited/open policies before defining the staff boundary.
drop policy if exists "staff manage leaflet adapter registry" on public.leaflet_adapter_registry;
create policy "staff manage leaflet adapter registry"
on public.leaflet_adapter_registry for all
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor'))
with check ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor'));

drop policy if exists "staff manage leaflet pipeline runs" on public.leaflet_pipeline_runs;
create policy "staff manage leaflet pipeline runs"
on public.leaflet_pipeline_runs for all
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor'))
with check ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor'));

drop policy if exists "staff manage leaflet ocr runs" on public.leaflet_ocr_runs;
create policy "staff manage leaflet ocr runs"
on public.leaflet_ocr_runs for all
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor'))
with check ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor'));

-- This table already had RLS enabled but no policy, which made the health view unusable
-- once it is switched to security_invoker. Staff only need read access here.
drop policy if exists "staff read store product sync state" on public.store_product_sync_state;
create policy "staff read store product sync state"
on public.store_product_sync_state for select
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor'));

-- PostgreSQL 15+ supports security_invoker on views. This makes underlying RLS apply.
alter view public.products_missing_verified_images set (security_invoker = true);
alter view public.leaflet_source_pipeline_status set (security_invoker = true);
alter view public.store_product_sync_health set (security_invoker = true);

-- These are internal/admin views, never public write surfaces.
revoke all on table public.products_missing_verified_images from anon;
revoke all on table public.leaflet_source_pipeline_status from anon;
revoke all on table public.store_product_sync_health from anon;

revoke insert, update, delete, truncate, references, trigger
  on table public.products_missing_verified_images,
           public.leaflet_source_pipeline_status,
           public.store_product_sync_health
  from authenticated;

grant select on table public.products_missing_verified_images,
                      public.leaflet_source_pipeline_status,
                      public.store_product_sync_health
  to authenticated;

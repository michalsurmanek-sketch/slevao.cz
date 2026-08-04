drop view if exists public.public_product_leaflet_locations;

create table if not exists public.public_product_leaflet_locations (
  product_id uuid not null references public.products(id) on delete cascade,
  source_page integer not null,
  import_id uuid not null,
  store_id uuid not null references public.stores(id) on delete cascade,
  store_name text not null,
  store_slug text not null,
  valid_from date,
  valid_to date,
  page_count integer,
  document_url text,
  updated_at timestamptz not null default now(),
  primary key (product_id, import_id, source_page)
);

alter table public.public_product_leaflet_locations enable row level security;

drop policy if exists "Public read product leaflet locations" on public.public_product_leaflet_locations;
create policy "Public read product leaflet locations"
on public.public_product_leaflet_locations for select
to anon, authenticated
using (true);

drop policy if exists "Admins manage product leaflet locations" on public.public_product_leaflet_locations;
create policy "Admins manage product leaflet locations"
on public.public_product_leaflet_locations for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

insert into public.public_product_leaflet_locations (
  product_id, source_page, import_id, store_id, store_name, store_slug,
  valid_from, valid_to, page_count, document_url, updated_at
)
select distinct on (item.product_id, imp.id, item.source_page)
  item.product_id, item.source_page, imp.id, imp.store_id, s.name, s.slug,
  imp.detected_valid_from, imp.detected_valid_to, imp.page_count,
  coalesce(nullif(imp.metadata->>'source_original_url',''), imp.source_document_url), now()
from public.leaflet_import_items item
join public.leaflet_imports imp on imp.id = item.import_id
join public.stores s on s.id = imp.store_id
where item.product_id is not null
  and item.source_page is not null
  and imp.status in ('completed','published','processed')
  and coalesce(imp.detected_valid_to, current_date) >= current_date - 30
order by item.product_id, imp.id, item.source_page, item.updated_at desc
on conflict (product_id, import_id, source_page) do update set
  store_id = excluded.store_id, store_name = excluded.store_name, store_slug = excluded.store_slug,
  valid_from = excluded.valid_from, valid_to = excluded.valid_to, page_count = excluded.page_count,
  document_url = excluded.document_url, updated_at = now();

create or replace function public.sync_public_product_leaflet_location()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  imp_row public.leaflet_imports%rowtype;
  store_row public.stores%rowtype;
begin
  if tg_op = 'DELETE' then
    if old.product_id is not null and old.source_page is not null then
      delete from public.public_product_leaflet_locations
      where product_id = old.product_id and import_id = old.import_id and source_page = old.source_page;
    end if;
    return old;
  end if;

  if new.product_id is null or new.source_page is null then
    if tg_op = 'UPDATE' and old.product_id is not null and old.source_page is not null then
      delete from public.public_product_leaflet_locations
      where product_id = old.product_id and import_id = old.import_id and source_page = old.source_page;
    end if;
    return new;
  end if;

  select * into imp_row from public.leaflet_imports where id = new.import_id;
  if not found or imp_row.status not in ('completed','published','processed') then return new; end if;
  select * into store_row from public.stores where id = imp_row.store_id;
  if not found then return new; end if;

  insert into public.public_product_leaflet_locations (
    product_id, source_page, import_id, store_id, store_name, store_slug,
    valid_from, valid_to, page_count, document_url, updated_at
  ) values (
    new.product_id, new.source_page, imp_row.id, imp_row.store_id, store_row.name, store_row.slug,
    imp_row.detected_valid_from, imp_row.detected_valid_to, imp_row.page_count,
    coalesce(nullif(imp_row.metadata->>'source_original_url',''), imp_row.source_document_url), now()
  ) on conflict (product_id, import_id, source_page) do update set
    store_id = excluded.store_id, store_name = excluded.store_name, store_slug = excluded.store_slug,
    valid_from = excluded.valid_from, valid_to = excluded.valid_to, page_count = excluded.page_count,
    document_url = excluded.document_url, updated_at = now();

  if tg_op = 'UPDATE' and (old.product_id, old.import_id, old.source_page) is distinct from (new.product_id, new.import_id, new.source_page) then
    delete from public.public_product_leaflet_locations
    where product_id = old.product_id and import_id = old.import_id and source_page = old.source_page;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_public_product_leaflet_location() from public, anon, authenticated;

drop trigger if exists sync_public_product_leaflet_location_trigger on public.leaflet_import_items;
create trigger sync_public_product_leaflet_location_trigger
after insert or update or delete on public.leaflet_import_items
for each row execute function public.sync_public_product_leaflet_location();

create or replace function public.sync_public_product_leaflet_import()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.public_product_leaflet_locations cache
  set valid_from = new.detected_valid_from,
      valid_to = new.detected_valid_to,
      page_count = new.page_count,
      document_url = coalesce(nullif(new.metadata->>'source_original_url',''), new.source_document_url),
      updated_at = now()
  where cache.import_id = new.id;
  return new;
end;
$$;

revoke all on function public.sync_public_product_leaflet_import() from public, anon, authenticated;

drop trigger if exists sync_public_product_leaflet_import_trigger on public.leaflet_imports;
create trigger sync_public_product_leaflet_import_trigger
after update of detected_valid_from, detected_valid_to, page_count, source_document_url, metadata on public.leaflet_imports
for each row execute function public.sync_public_product_leaflet_import();

create index if not exists public_product_leaflet_locations_product_idx on public.public_product_leaflet_locations(product_id, valid_to desc);
create index if not exists public_product_leaflet_locations_store_idx on public.public_product_leaflet_locations(store_id, valid_to desc);

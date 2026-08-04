create or replace function public.sync_public_product_leaflet_import()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status not in ('completed','published','processed') then
    delete from public.public_product_leaflet_locations where import_id = new.id;
    return new;
  end if;

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
after update of status, detected_valid_from, detected_valid_to, page_count, source_document_url, metadata on public.leaflet_imports
for each row execute function public.sync_public_product_leaflet_import();

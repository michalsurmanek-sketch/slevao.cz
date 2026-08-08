-- BENU exposes a live online action catalog without an explicit validity end.
-- Its adapter refreshes daily, so older overlapping snapshots of the same titles
-- must not remain public alongside the newest snapshot.

create or replace function public.expire_replaced_benu_live_catalog_offers()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status <> 'published'
     or coalesce(old.status, '') = 'published'
     or new.metadata ->> 'adapter' <> 'benu-html-v1'
     or new.detected_valid_from is null then
    return new;
  end if;

  update public.offers o
  set status = 'expired',
      metadata = coalesce(o.metadata, '{}'::jsonb) || jsonb_build_object(
        '_superseded_live_catalog_at', now(),
        '_superseded_by_import_id', new.id,
        '_superseded_reason', 'newer_benu_live_catalog_snapshot'
      ),
      updated_at = now()
  where o.store_id = new.store_id
    and o.status = 'published'
    and o.valid_from < new.detected_valid_from
    and exists (
      select 1
      from public.leaflet_import_items i
      where i.import_id = new.id
        and lower(btrim(i.title)) = lower(btrim(o.title))
    );

  return new;
end;
$function$;

revoke all on function public.expire_replaced_benu_live_catalog_offers() from public, anon, authenticated;
grant execute on function public.expire_replaced_benu_live_catalog_offers() to service_role;

drop trigger if exists trg_expire_replaced_benu_live_catalog_offers on public.leaflet_imports;
create trigger trg_expire_replaced_benu_live_catalog_offers
after update of status on public.leaflet_imports
for each row
when (new.status = 'published')
execute function public.expire_replaced_benu_live_catalog_offers();
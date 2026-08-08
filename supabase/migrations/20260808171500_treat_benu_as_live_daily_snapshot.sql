-- BENU /benu-letak/akce is a live online action catalog. The page does not
-- publish an explicit end date, so do not invent a seven-day validity window.

create or replace function public.normalize_benu_live_catalog_validity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.metadata ->> 'adapter' = 'benu-html-v1'
     and new.detected_valid_from is not null then
    new.detected_valid_to := new.detected_valid_from;
    new.metadata := coalesce(new.metadata, '{}'::jsonb)
      || jsonb_build_object('validity_strategy', 'live_catalog_same_day_snapshot');
  end if;
  return new;
end;
$function$;

revoke all on function public.normalize_benu_live_catalog_validity() from public, anon, authenticated;
grant execute on function public.normalize_benu_live_catalog_validity() to service_role;

drop trigger if exists trg_normalize_benu_live_catalog_validity on public.leaflet_imports;
create trigger trg_normalize_benu_live_catalog_validity
before insert or update of detected_valid_from, detected_valid_to, metadata
on public.leaflet_imports
for each row
execute function public.normalize_benu_live_catalog_validity();

with latest as (
  select li.id, li.store_id, li.detected_valid_from, li.detected_valid_to
  from public.leaflet_imports li
  join public.stores s on s.id = li.store_id
  where s.slug = 'benu'
    and li.metadata ->> 'adapter' = 'benu-html-v1'
    and li.status = 'published'
  order by li.created_at desc
  limit 1
), fixed_import as (
  update public.leaflet_imports li
  set detected_valid_to = latest.detected_valid_from,
      metadata = coalesce(li.metadata, '{}'::jsonb)
        || jsonb_build_object('validity_strategy', 'live_catalog_same_day_snapshot'),
      updated_at = now()
  from latest
  where li.id = latest.id
  returning latest.store_id, latest.detected_valid_from, latest.detected_valid_to
)
update public.offers o
set valid_to = f.detected_valid_from,
    metadata = coalesce(o.metadata, '{}'::jsonb)
      || jsonb_build_object('validity_strategy', 'live_catalog_same_day_snapshot'),
    updated_at = now()
from fixed_import f
where o.store_id = f.store_id
  and o.status = 'published'
  and o.valid_from = f.detected_valid_from
  and o.valid_to = f.detected_valid_to;
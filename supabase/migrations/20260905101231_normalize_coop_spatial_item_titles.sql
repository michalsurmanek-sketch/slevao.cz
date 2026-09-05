create or replace function private.normalize_coop_spatial_item_title()
returns trigger
language plpgsql
set search_path to 'public','private','pg_temp'
as $$
declare
  v_adapter text;
  v_parser text;
begin
  select li.metadata->>'adapter', li.metadata->>'parser'
    into v_adapter, v_parser
  from public.leaflet_imports li
  where li.id = new.import_id;

  if coalesce(v_adapter,'') <> 'coop-pdf-spatial-unit-price-v4'
     and coalesce(v_parser,'') <> 'coop-pdf-spatial-unit-price-v4' then
    return new;
  end if;

  if position(' · ' in coalesce(new.title,'')) > 0 then
    new.title := btrim(split_part(new.title, ' · ', 1));
    new.raw_data := coalesce(new.raw_data,'{}'::jsonb) || jsonb_build_object(
      'public_title_normalized', true,
      'public_title_normalizer', 'coop_spatial_base_title_v1'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists zy_coop_spatial_strip_title_suffix on public.leaflet_import_items;
create trigger zy_coop_spatial_strip_title_suffix
before insert or update of title, quantity_text, unit_label, status, raw_data, import_id
on public.leaflet_import_items
for each row execute function private.normalize_coop_spatial_item_title();

update public.leaflet_import_items lii
set title = lii.title
from public.leaflet_imports li
where lii.import_id = li.id
  and (li.metadata->>'adapter' = 'coop-pdf-spatial-unit-price-v4'
       or li.metadata->>'parser' = 'coop-pdf-spatial-unit-price-v4')
  and position(' · ' in coalesce(lii.title,'')) > 0;

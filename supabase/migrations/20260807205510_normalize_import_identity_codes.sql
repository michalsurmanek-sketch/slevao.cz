create or replace function public.normalize_leaflet_import_identity_codes()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  incoming text;
  gtin text;
begin
  if new.raw_data is null then
    return new;
  end if;

  incoming := regexp_replace(coalesce(new.raw_data->>'incoming_ean',''), '\D', '', 'g');
  gtin := regexp_replace(coalesce(new.raw_data->>'gtin',''), '\D', '', 'g');

  if length(incoming) between 8 and 14
     and not (length(gtin) between 8 and 14) then
    new.raw_data := jsonb_set(new.raw_data, '{gtin}', to_jsonb(incoming), true);
  end if;

  return new;
end;
$$;

drop trigger if exists leaflet_import_identity_codes_trigger on public.leaflet_import_items;
create trigger leaflet_import_identity_codes_trigger
before insert or update of raw_data
on public.leaflet_import_items
for each row
execute function public.normalize_leaflet_import_identity_codes();

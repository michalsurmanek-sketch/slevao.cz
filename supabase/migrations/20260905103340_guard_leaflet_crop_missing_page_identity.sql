create or replace function private.guard_leaflet_crop_page_identity()
returns trigger
language plpgsql
set search_path to 'public','private','pg_temp'
as $$
declare
  v_page_count integer;
  v_page_url text;
begin
  if nullif(btrim(coalesce(new.image_url,'')),'') is not null then
    return new;
  end if;

  select li.page_count
    into v_page_count
  from public.leaflet_imports li
  where li.id = new.import_id;

  v_page_url := btrim(coalesce(new.raw_data->>'page_image_url',''));

  if coalesce(v_page_count,1) > 1
     and new.source_page is null
     and v_page_url = '' then
    new.raw_data := jsonb_set(
      coalesce(new.raw_data,'{}'::jsonb),
      '{leaflet_crop}',
      jsonb_build_object(
        'provider','crop_page_identity_guard_v1',
        'status','no_safe_product_image',
        'reason','missing_exact_source_page',
        'generated_at',clock_timestamp()
      ),
      true
    );
  elsif (new.source_page is not null or v_page_url <> '')
        and coalesce(new.raw_data->'leaflet_crop'->>'provider','')='crop_page_identity_guard_v1' then
    new.raw_data := new.raw_data - 'leaflet_crop';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_leaflet_crop_page_identity_trg on public.leaflet_import_items;
create trigger guard_leaflet_crop_page_identity_trg
before insert or update of import_id,source_page,image_url,raw_data on public.leaflet_import_items
for each row execute function private.guard_leaflet_crop_page_identity();

update public.leaflet_import_items lii
set raw_data = jsonb_set(
  coalesce(lii.raw_data,'{}'::jsonb),
  '{leaflet_crop}',
  jsonb_build_object(
    'provider','crop_page_identity_guard_v1',
    'status','no_safe_product_image',
    'reason','missing_exact_source_page',
    'generated_at',clock_timestamp()
  ),
  true
)
from public.leaflet_imports li
where li.id=lii.import_id
  and coalesce(li.page_count,1)>1
  and lii.source_page is null
  and btrim(coalesce(lii.raw_data->>'page_image_url',''))=''
  and btrim(coalesce(lii.image_url,''))=''
  and lii.status not in ('ignored','rejected');

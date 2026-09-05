create or replace function private.coop_pdf_page_image_url(p_pdf_url text, p_page integer)
returns text
language sql
immutable strict
set search_path to 'pg_catalog','pg_temp'
as $$
  select case
    when p_page < 1 then null
    when p_pdf_url !~* '^https://www\.coopclub\.cz/.+\.pdf(?:\?.*)?$' then null
    else 'https://wsrv.nl/?url=' ||
      replace(replace(replace(replace(replace(replace(replace(p_pdf_url,
        '%','%25'), ':','%3A'), '/','%2F'), '?','%3F'), '&','%26'), '=','%3D'), ' ','%20') ||
      '&page=' || (p_page - 1)::text || '&w=1600&output=jpg&q=90'
  end;
$$;

create or replace function private.attach_coop_import_item_page_image()
returns trigger
language plpgsql
set search_path to 'public','private','pg_temp'
as $$
declare
  v_pdf_url text;
  v_adapter text;
  v_parser text;
  v_page_url text;
begin
  if new.source_page is null or new.source_page < 1 then
    return new;
  end if;

  select li.source_document_url, li.metadata->>'adapter', li.metadata->>'parser'
    into v_pdf_url, v_adapter, v_parser
  from public.leaflet_imports li
  where li.id = new.import_id;

  if coalesce(v_adapter,'') not in ('coop-verified-pdf-text-v1','coop-pdf-spatial-unit-price-v4')
     and coalesce(v_parser,'') <> 'coop-pdf-spatial-unit-price-v4' then
    return new;
  end if;

  v_page_url := private.coop_pdf_page_image_url(v_pdf_url, new.source_page);
  if v_page_url is null then
    return new;
  end if;

  new.raw_data := coalesce(new.raw_data,'{}'::jsonb) || jsonb_build_object(
    'page_image_url', v_page_url,
    'page_image_source', 'coop_official_pdf_render',
    'page_image_page', new.source_page
  );
  return new;
end;
$$;

drop trigger if exists attach_coop_import_item_page_image_trg on public.leaflet_import_items;
create trigger attach_coop_import_item_page_image_trg
before insert or update of source_page, import_id on public.leaflet_import_items
for each row execute function private.attach_coop_import_item_page_image();

update public.leaflet_import_items lii
set raw_data = coalesce(lii.raw_data,'{}'::jsonb) || jsonb_build_object(
  'page_image_url', private.coop_pdf_page_image_url(li.source_document_url, lii.source_page),
  'page_image_source', 'coop_official_pdf_render',
  'page_image_page', lii.source_page
)
from public.leaflet_imports li
join public.stores s on s.id = li.store_id
where lii.import_id = li.id
  and s.slug = 'coop'
  and lii.source_page is not null
  and private.coop_pdf_page_image_url(li.source_document_url, lii.source_page) is not null;

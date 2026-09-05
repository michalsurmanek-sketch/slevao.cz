create or replace function private.flop_pdf_page_image_url(p_pdf_url text, p_page integer)
returns text
language sql
immutable
strict
security invoker
set search_path to 'pg_catalog','pg_temp'
as $function$
  select case
    when p_page < 1 then null
    when p_pdf_url !~* '^https://(www\.)?flop-potraviny\.cz/wp-content/uploads/.+\.pdf(?:\?.*)?$' then null
    else 'https://wsrv.nl/?url=' ||
      replace(replace(replace(replace(replace(replace(replace(p_pdf_url,
        '%','%25'), ':','%3A'), '/','%2F'), '?','%3F'), '&','%26'), '=','%3D'), ' ','%20') ||
      '&page=' || (p_page - 1)::text || '&w=1600&output=jpg&q=90'
  end;
$function$;

revoke all on function private.flop_pdf_page_image_url(text,integer) from public, anon, authenticated;

create or replace function private.attach_flop_import_item_page_image()
returns trigger
language plpgsql
security invoker
set search_path to 'public','private','pg_temp'
as $function$
declare
  v_pdf_url text;
  v_adapter text;
  v_page_url text;
begin
  if new.source_page is null or new.source_page < 1 then
    return new;
  end if;

  select li.source_document_url, li.metadata->>'adapter'
    into v_pdf_url, v_adapter
  from public.leaflet_imports li
  where li.id = new.import_id;

  if v_adapter is distinct from 'flop-pdf-spatial-unit-price-v4' then
    return new;
  end if;

  v_page_url := private.flop_pdf_page_image_url(v_pdf_url, new.source_page);
  if v_page_url is null then
    return new;
  end if;

  new.raw_data := coalesce(new.raw_data, '{}'::jsonb) || jsonb_build_object(
    'page_image_url', v_page_url,
    'page_image_source', 'flop_official_pdf_render',
    'page_image_page', new.source_page
  );
  return new;
end;
$function$;

revoke all on function private.attach_flop_import_item_page_image() from public, anon, authenticated;

drop trigger if exists attach_flop_import_item_page_image_trg on public.leaflet_import_items;
create trigger attach_flop_import_item_page_image_trg
before insert or update of source_page
on public.leaflet_import_items
for each row
execute function private.attach_flop_import_item_page_image();

update public.leaflet_import_items item
set raw_data = coalesce(item.raw_data, '{}'::jsonb) || jsonb_build_object(
  'page_image_url', private.flop_pdf_page_image_url(li.source_document_url, item.source_page),
  'page_image_source', 'flop_official_pdf_render',
  'page_image_page', item.source_page
)
from public.leaflet_imports li
join public.stores s on s.id = li.store_id
where item.import_id = li.id
  and s.slug = 'flop'
  and li.metadata->>'adapter' = 'flop-pdf-spatial-unit-price-v4'
  and item.source_page is not null
  and item.source_page >= 1
  and private.flop_pdf_page_image_url(li.source_document_url, item.source_page) is not null
  and nullif(trim(coalesce(item.raw_data->>'page_image_url','')), '') is null;

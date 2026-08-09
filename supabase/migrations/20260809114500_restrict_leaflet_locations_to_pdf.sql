-- Keep leaflet page links only for real PDF documents.

update public.offers
set metadata = coalesce(metadata, '{}'::jsonb) - 'leaflet_page' - 'leaflet_document_url',
    updated_at = now()
where metadata ? 'leaflet_document_url'
  and coalesce(metadata->>'leaflet_document_url', '') !~* '\.pdf(?:\?|$)';

create or replace function public.attach_leaflet_location_to_offer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer_id uuid;
  v_document_url text;
begin
  if new.source_page is null
     or coalesce(new.raw_data->>'offer_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return new;
  end if;

  v_offer_id := (new.raw_data->>'offer_id')::uuid;

  select source_document_url
  into v_document_url
  from public.leaflet_imports
  where id = new.import_id;

  if v_document_url is null or v_document_url !~* '\.pdf(?:\?|$)' then
    return new;
  end if;

  update public.offers
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'leaflet_page', new.source_page,
    'leaflet_document_url', v_document_url
  ),
  updated_at = now()
  where id = v_offer_id;

  return new;
end;
$$;

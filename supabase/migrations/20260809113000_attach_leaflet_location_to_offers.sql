-- Attach reliable leaflet page/document evidence to published offers without a new Edge Function.

with linked as (
  select distinct on ((lii.raw_data->>'offer_id')::uuid)
    (lii.raw_data->>'offer_id')::uuid as offer_id,
    lii.source_page,
    li.source_document_url
  from public.leaflet_import_items lii
  join public.leaflet_imports li on li.id = lii.import_id
  where lii.source_page is not null
    and li.source_document_url is not null
    and lii.raw_data->>'offer_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  order by (lii.raw_data->>'offer_id')::uuid, lii.updated_at desc, lii.created_at desc
)
update public.offers o
set metadata = coalesce(o.metadata, '{}'::jsonb) || jsonb_build_object(
  'leaflet_page', linked.source_page,
  'leaflet_document_url', linked.source_document_url
),
updated_at = now()
from linked
where o.id = linked.offer_id
  and (
    o.metadata->>'leaflet_page' is distinct from linked.source_page::text
    or o.metadata->>'leaflet_document_url' is distinct from linked.source_document_url
  );

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

  if v_document_url is null then
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

drop trigger if exists trg_attach_leaflet_location_to_offer on public.leaflet_import_items;
create trigger trg_attach_leaflet_location_to_offer
after insert or update of source_page, raw_data, import_id
on public.leaflet_import_items
for each row execute function public.attach_leaflet_location_to_offer();

-- Canonical leaflet page identity independent from OCR.
-- Official source adapters can persist page images/text here without affecting OCR completion.

create table if not exists public.leaflet_document_pages (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  source_document_url text not null,
  source_kind text not null,
  page_number integer not null check (page_number between 1 and 200),
  page_id text,
  image_url text not null,
  zoom_url text,
  thumbnail_url text,
  image_width integer check (image_width is null or image_width > 0),
  image_height integer check (image_height is null or image_height > 0),
  alt_text text,
  keywords text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_document_url, page_number, source_kind)
);

create index if not exists idx_leaflet_document_pages_store_document
  on public.leaflet_document_pages(store_id, source_document_url, page_number);

alter table public.leaflet_document_pages enable row level security;
revoke all on table public.leaflet_document_pages from public, anon, authenticated;
grant all on table public.leaflet_document_pages to service_role;

-- Public schema is required for PostgREST RPC discovery. Execute is service-role only,
-- so this remains an internal atomic writer even though the function is discoverable.
create or replace function public.replace_leaflet_document_pages_internal(
  p_store_id uuid,
  p_source_document_url text,
  p_source_kind text,
  p_pages jsonb
)
returns integer
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $function$
declare
  v_count integer;
  v_distinct integer;
  v_min integer;
  v_max integer;
begin
  if p_store_id is null or not exists(select 1 from public.stores s where s.id=p_store_id) then
    raise exception 'Leaflet document pages: store not found.';
  end if;
  if p_source_document_url is null or p_source_document_url !~ '^https://[^[:space:]]+$' then
    raise exception 'Leaflet document pages: invalid source document URL.';
  end if;
  if p_source_kind is null or length(trim(p_source_kind)) < 3 or length(p_source_kind) > 120 then
    raise exception 'Leaflet document pages: invalid source kind.';
  end if;
  if jsonb_typeof(p_pages) <> 'array' then
    raise exception 'Leaflet document pages: pages must be an array.';
  end if;
  if exists(
    select 1
    from jsonb_array_elements(p_pages) x
    where coalesce(x->>'page_number','') !~ '^[1-9][0-9]{0,2}$'
       or coalesce(x->>'image_url','') !~ '^https://[^[:space:]]+$'
  ) then
    raise exception 'Leaflet document pages: invalid page payload.';
  end if;

  select count(*)::integer,
         count(distinct (x->>'page_number')::integer)::integer,
         min((x->>'page_number')::integer),
         max((x->>'page_number')::integer)
    into v_count,v_distinct,v_min,v_max
  from jsonb_array_elements(p_pages) x;

  if v_count < 1 or v_count > 200 then
    raise exception 'Leaflet document pages: invalid page count %.',v_count;
  end if;
  if v_distinct <> v_count or v_min <> 1 or v_max <> v_count then
    raise exception 'Leaflet document pages: page numbers must be unique and contiguous 1..N.';
  end if;

  delete from public.leaflet_document_pages
  where source_document_url=p_source_document_url
    and source_kind=p_source_kind;

  insert into public.leaflet_document_pages(
    store_id,source_document_url,source_kind,page_number,page_id,image_url,zoom_url,thumbnail_url,
    image_width,image_height,alt_text,keywords,metadata,updated_at
  )
  select
    p_store_id,
    p_source_document_url,
    p_source_kind,
    (x->>'page_number')::integer,
    nullif(x->>'page_id',''),
    x->>'image_url',
    nullif(x->>'zoom_url',''),
    nullif(x->>'thumbnail_url',''),
    case when coalesce(x->>'image_width','') ~ '^[1-9][0-9]*$' then (x->>'image_width')::integer end,
    case when coalesce(x->>'image_height','') ~ '^[1-9][0-9]*$' then (x->>'image_height')::integer end,
    nullif(x->>'alt_text',''),
    nullif(x->>'keywords',''),
    coalesce(x->'metadata','{}'::jsonb),
    now()
  from jsonb_array_elements(p_pages) x
  order by (x->>'page_number')::integer;

  return v_count;
end;
$function$;

revoke all on function public.replace_leaflet_document_pages_internal(uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.replace_leaflet_document_pages_internal(uuid,text,text,jsonb) to service_role;

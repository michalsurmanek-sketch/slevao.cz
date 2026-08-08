create table if not exists public.leaflet_ocr_pages (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.leaflet_imports(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  image_url text not null,
  engine text not null,
  language text not null default 'ces',
  image_width integer,
  image_height integer,
  text_content text not null default '',
  words jsonb not null default '[]'::jsonb,
  avg_confidence numeric(6,3),
  word_count integer not null default 0,
  checksum text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (import_id, page_number, engine)
);

alter table public.leaflet_ocr_pages enable row level security;
revoke all on table public.leaflet_ocr_pages from anon, authenticated;
grant all on table public.leaflet_ocr_pages to service_role;

create index if not exists idx_leaflet_ocr_pages_import
  on public.leaflet_ocr_pages(import_id, page_number);

comment on table public.leaflet_ocr_pages is
  'Private per-page OCR output from trusted workers, including word bounding boxes for deterministic leaflet parsers.';

create or replace function public.get_terno_ocr_target()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.leaflet_imports%rowtype;
  v_pages jsonb;
begin
  select li.* into v_row
  from public.leaflet_imports li
  join public.stores s on s.id = li.store_id
  where s.slug = 'terno'
    and li.detected_valid_from <= current_date
    and li.detected_valid_to >= current_date
    and coalesce(li.metadata->>'title', '') = 'Akční nabídka'
    and jsonb_typeof(li.metadata->'page_image_urls') = 'array'
    and jsonb_array_length(li.metadata->'page_image_urls') > 0
  order by li.created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'missing_current_terno_action_flyer');
  end if;

  v_pages := v_row.metadata->'page_image_urls';

  return jsonb_build_object(
    'ok', true,
    'import_id', v_row.id,
    'source_document_url', v_row.source_document_url,
    'valid_from', v_row.detected_valid_from,
    'valid_to', v_row.detected_valid_to,
    'coverage_scope', v_row.coverage_scope,
    'city_name', v_row.city_name,
    'page_count', jsonb_array_length(v_pages),
    'page_image_urls', v_pages,
    'ocr_complete_pages', (
      select count(*)
      from public.leaflet_ocr_pages p
      where p.import_id = v_row.id
        and p.engine = 'tesseract-cli-ces-v1'
        and p.word_count > 0
    )
  );
end;
$$;

revoke all on function public.get_terno_ocr_target() from public, anon, authenticated;
grant execute on function public.get_terno_ocr_target() to service_role;

comment on function public.get_terno_ocr_target() is
  'Returns only the current Terno Akční nabídka import and its persisted official flipbook page images to service-role workers.';

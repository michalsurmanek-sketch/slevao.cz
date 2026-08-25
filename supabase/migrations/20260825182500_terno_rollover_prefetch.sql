create or replace function public.get_terno_ocr_target()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.leaflet_imports%rowtype;
  v_pages jsonb;
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_tomorrow date := ((now() at time zone 'Europe/Prague')::date + 1);
begin
  select li.* into v_row
  from public.leaflet_imports li
  join public.stores s on s.id = li.store_id
  where s.slug = 'terno'
    and li.detected_valid_from <= v_tomorrow
    and li.detected_valid_to >= v_today
    and coalesce(li.metadata->>'title', '') = 'Akční nabídka'
    and jsonb_typeof(li.metadata->'page_image_urls') = 'array'
    and jsonb_array_length(li.metadata->'page_image_urls') > 0
  order by
    case
      when li.detected_valid_from <= v_today
       and li.detected_valid_to >= v_today
       and (select count(*) from public.leaflet_ocr_pages p
            where p.import_id=li.id and p.engine='tesseract-cli-ces-v1' and p.word_count>0)
           < jsonb_array_length(li.metadata->'page_image_urls') then 0
      when li.detected_valid_from <= v_tomorrow
       and li.detected_valid_to >= v_tomorrow
       and (select count(*) from public.leaflet_ocr_pages p
            where p.import_id=li.id and p.engine='tesseract-cli-ces-v1' and p.word_count>0)
           < jsonb_array_length(li.metadata->'page_image_urls') then 1
      else 2
    end,
    li.detected_valid_from desc,
    li.created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'missing_today_or_tomorrow_terno_action_flyer');
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
    'target_date', case when v_row.detected_valid_from > v_today then v_tomorrow else v_today end,
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
  'Returns the incomplete Terno Akční nabídka for Prague today first, then tomorrow, so OCR can prefetch the next leaflet safely.';

create or replace function public.preserve_terno_official_validity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_terno_store_id uuid;
begin
  if old.detected_valid_from is null and old.detected_valid_to is null then
    return new;
  end if;

  select id into v_terno_store_id from public.stores where slug='terno' limit 1;
  if old.store_id<>v_terno_store_id
     or coalesce(old.metadata->>'adapter','')<>'store:terno-zlin-pdf-v1' then
    return new;
  end if;

  if new.detected_valid_from is null and old.detected_valid_from is not null then
    new.detected_valid_from:=old.detected_valid_from;
  end if;
  if new.detected_valid_to is null and old.detected_valid_to is not null then
    new.detected_valid_to:=old.detected_valid_to;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_preserve_terno_official_validity on public.leaflet_imports;
create trigger trg_preserve_terno_official_validity
before update of detected_valid_from,detected_valid_to on public.leaflet_imports
for each row
execute function public.preserve_terno_official_validity();

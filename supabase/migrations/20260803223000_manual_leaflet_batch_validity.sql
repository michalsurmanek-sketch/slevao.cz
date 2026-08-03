create or replace function public.normalize_manual_leaflet_batch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  filename text;
  batch_match text[];
  page_match text[];
  date_match text[];
  batch_id text;
  parsed_from date;
  parsed_to date;
  sibling_from date;
  sibling_to date;
begin
  if not coalesce(new.metadata @> '{"manual_upload":true}'::jsonb, false) then
    return new;
  end if;

  filename := nullif(new.metadata->>'original_filename', '');
  if filename is null then
    return new;
  end if;

  batch_match := regexp_match(filename, '__batch-([0-9a-fA-F-]{36})');
  if batch_match is not null then
    batch_id := lower(batch_match[1]);
    new.metadata := jsonb_set(coalesce(new.metadata, '{}'::jsonb), '{page_batch_id}', to_jsonb(batch_id), true);
  end if;

  page_match := regexp_match(filename, '__page-([0-9]+)-of-([0-9]+)');
  if page_match is not null then
    new.metadata := jsonb_set(coalesce(new.metadata, '{}'::jsonb), '{page_number}', to_jsonb(page_match[1]::integer), true);
    new.metadata := jsonb_set(coalesce(new.metadata, '{}'::jsonb), '{page_total}', to_jsonb(page_match[2]::integer), true);
  end if;

  date_match := regexp_match(filename, '([0-3][0-9])[-_.]([01][0-9])[-_.](20[0-9]{2})[-_.]([0-3][0-9])[-_.]([01][0-9])[-_.](20[0-9]{2})');
  if date_match is not null then
    begin
      parsed_from := make_date(date_match[3]::integer, date_match[2]::integer, date_match[1]::integer);
      parsed_to := make_date(date_match[6]::integer, date_match[5]::integer, date_match[4]::integer);
      if parsed_from <= parsed_to then
        new.detected_valid_from := parsed_from;
        new.detected_valid_to := parsed_to;
        new.metadata := jsonb_set(coalesce(new.metadata, '{}'::jsonb), '{validity_source}', '"filename"'::jsonb, true);
      end if;
    exception when others then
      null;
    end;
  elsif batch_id is not null and (new.detected_valid_from is null or new.detected_valid_to is null) then
    select li.detected_valid_from, li.detected_valid_to
      into sibling_from, sibling_to
    from public.leaflet_imports li
    where li.id is distinct from new.id
      and li.store_id = new.store_id
      and li.metadata->>'page_batch_id' = batch_id
      and li.detected_valid_from is not null
      and li.detected_valid_to is not null
    order by li.updated_at desc
    limit 1;

    if sibling_from is not null and sibling_to is not null then
      new.detected_valid_from := sibling_from;
      new.detected_valid_to := sibling_to;
      new.metadata := jsonb_set(coalesce(new.metadata, '{}'::jsonb), '{validity_source}', '"batch_sibling"'::jsonb, true);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_manual_leaflet_batch on public.leaflet_imports;
create trigger trg_normalize_manual_leaflet_batch
before insert or update of metadata, detected_valid_from, detected_valid_to
on public.leaflet_imports
for each row
execute function public.normalize_manual_leaflet_batch();

create or replace function public.propagate_manual_leaflet_batch_validity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  batch_id text;
begin
  batch_id := nullif(new.metadata->>'page_batch_id', '');
  if batch_id is null or new.detected_valid_from is null or new.detected_valid_to is null then
    return new;
  end if;

  update public.leaflet_imports li
  set detected_valid_from = new.detected_valid_from,
      detected_valid_to = new.detected_valid_to,
      metadata = jsonb_set(coalesce(li.metadata, '{}'::jsonb), '{validity_source}', '"batch_shared"'::jsonb, true)
  where li.id <> new.id
    and li.store_id = new.store_id
    and li.metadata->>'page_batch_id' = batch_id
    and (
      li.detected_valid_from is distinct from new.detected_valid_from
      or li.detected_valid_to is distinct from new.detected_valid_to
    );

  return new;
end;
$$;

drop trigger if exists trg_propagate_manual_leaflet_batch_validity on public.leaflet_imports;
create trigger trg_propagate_manual_leaflet_batch_validity
after insert or update of detected_valid_from, detected_valid_to, metadata
on public.leaflet_imports
for each row
when (new.detected_valid_from is not null and new.detected_valid_to is not null)
execute function public.propagate_manual_leaflet_batch_validity();

update public.leaflet_imports
set metadata = metadata
where metadata @> '{"manual_upload":true}'::jsonb
  and metadata ? 'original_filename';

update public.leaflet_imports
set status = 'review',
    error_message = null,
    finished_at = coalesce(finished_at, now())
where metadata @> '{"manual_upload":true}'::jsonb
  and status = 'failed'
  and coalesce(product_count, 0) > 0
  and (
    error_message = 'Import nemá spolehlivě rozpoznanou platnost letáku.'
    or error_message like 'Import ve stavu failed nelze publikovat.%'
  );
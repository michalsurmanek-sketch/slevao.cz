-- process-leaflet-basic can successfully extract items but fail its final import UPDATE
-- when noisy PDF text is misread as an impossible date. The Edge Function currently
-- does not surface that update error and may leave leaflet_imports in `processing`.
-- Reconcile a completed parser run at the database boundary and prefer the ISO week
-- encoded in official filenames such as 2026-32_CZ.pdf.

create or replace function public.reconcile_basic_parser_import(p_import_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_import record;
  v_match text[];
  v_from date;
  v_to date;
  v_items integer := 0;
begin
  select id, status, source_document_url, detected_valid_from, detected_valid_to, metadata
  into v_import
  from public.leaflet_imports
  where id = p_import_id
  for update;

  if not found or v_import.status <> 'processing' then
    return;
  end if;

  select count(*)::integer
  into v_items
  from public.leaflet_import_items
  where import_id = p_import_id
    and status in ('review','published');

  v_match := regexp_match(
    coalesce(v_import.source_document_url,''),
    '([0-9]{4})-([0-9]{2})_CZ\\.pdf',
    'i'
  );

  if v_match is not null then
    begin
      v_from := to_date(v_match[1] || v_match[2] || '1', 'IYYYIWID');
      v_to := v_from + 6;
    exception when others then
      v_from := null;
      v_to := null;
    end;
  end if;

  update public.leaflet_imports
  set status = 'review',
      product_count = v_items,
      detected_valid_from = coalesce(detected_valid_from, v_from),
      detected_valid_to = coalesce(detected_valid_to, v_to),
      confidence = case when v_items > 0 then coalesce(confidence, 0.58) else confidence end,
      error_message = case
        when v_items > 0 then null
        else coalesce(error_message, 'Základní PDF parser nenašel spolehlivé položky.')
      end,
      finished_at = coalesce(finished_at, now()),
      metadata = jsonb_set(
        jsonb_set(coalesce(metadata,'{}'::jsonb), '{processor}', to_jsonb('process-leaflet-basic'::text), true),
        '{parser_reconciled}',
        'true'::jsonb,
        true
      ),
      updated_at = now()
  where id = p_import_id;
end;
$$;

create or replace function public.reconcile_completed_basic_parser_run()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.reconcile_basic_parser_import(new.import_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reconcile_completed_basic_parser_run on public.leaflet_basic_parser_runs;
create trigger trg_reconcile_completed_basic_parser_run
after insert or update of status on public.leaflet_basic_parser_runs
for each row execute function public.reconcile_completed_basic_parser_run();

-- Client roles never need to invoke these internal reconciliation helpers directly.
revoke execute on function public.reconcile_basic_parser_import(uuid) from public, anon, authenticated;
revoke execute on function public.reconcile_completed_basic_parser_run() from public, anon, authenticated;
grant execute on function public.reconcile_basic_parser_import(uuid) to service_role;

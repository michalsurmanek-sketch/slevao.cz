do $$
declare
  v_expected integer := 73;
  v_candidates integer;
  v_archived integer;
  v_deleted integer;
begin
  select count(*) into v_candidates
  from public.price_history ph
  join public.stores s on s.id=ph.store_id
  where s.name='Lidl'
    and ph.recorded_at >= '2026-08-05 18:49:00+00'::timestamptz
    and ph.recorded_at < '2026-08-05 18:50:00+00'::timestamptz
    and ph.valid_from=date '2026-08-03'
    and ph.valid_to=date '2026-08-09'
    and ph.offer_id is null
    and ph.source_url is null
    and ph.metadata='{}'::jsonb;

  if v_candidates <> v_expected then
    raise exception 'Lidl OCR history candidate count changed: expected %, got %', v_expected, v_candidates;
  end if;

  insert into public.price_history_quarantine (original_id, snapshot, quarantine_reason)
  select ph.id, to_jsonb(ph), 'unprovenanced_lidl_ocr_batch_2026_08_05'
  from public.price_history ph
  join public.stores s on s.id=ph.store_id
  where s.name='Lidl'
    and ph.recorded_at >= '2026-08-05 18:49:00+00'::timestamptz
    and ph.recorded_at < '2026-08-05 18:50:00+00'::timestamptz
    and ph.valid_from=date '2026-08-03'
    and ph.valid_to=date '2026-08-09'
    and ph.offer_id is null
    and ph.source_url is null
    and ph.metadata='{}'::jsonb
  on conflict (original_id) do nothing;
  get diagnostics v_archived = row_count;

  if v_archived <> v_expected then
    raise exception 'Lidl OCR history archive count mismatch: expected %, archived %', v_expected, v_archived;
  end if;

  delete from public.price_history ph
  using public.price_history_quarantine q
  where q.original_id=ph.id and q.quarantine_reason='unprovenanced_lidl_ocr_batch_2026_08_05';
  get diagnostics v_deleted = row_count;

  if v_deleted <> v_expected then
    raise exception 'Lidl OCR history delete count mismatch: expected %, deleted %', v_expected, v_deleted;
  end if;
end
$$;

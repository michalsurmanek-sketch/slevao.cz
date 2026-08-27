do $$
declare
  v_expected integer := 20;
  v_candidates integer;
  v_archived integer;
  v_deleted integer;
begin
  select count(*) into v_candidates
  from public.price_history ph
  join public.offers o on o.id=ph.offer_id
  where o.metadata ->> '_bulk_reset_run_id' = '61b144bb-0980-4dcb-89ab-3453147cf6b7'
    and o.status in ('review','rejected')
    and o.is_verified=false
    and (o.metadata ? 'quality_rejection' or o.metadata ? '_quality_quarantine_reason');

  if v_candidates <> v_expected then
    raise exception 'legacy bulk reset price history candidate count changed: expected %, got %', v_expected, v_candidates;
  end if;

  insert into public.price_history_quarantine (original_id, snapshot, quarantine_reason)
  select ph.id,
         to_jsonb(ph),
         'legacy_bulk_reset_quality_quarantine_61b144bb'
  from public.price_history ph
  join public.offers o on o.id=ph.offer_id
  where o.metadata ->> '_bulk_reset_run_id' = '61b144bb-0980-4dcb-89ab-3453147cf6b7'
    and o.status in ('review','rejected')
    and o.is_verified=false
    and (o.metadata ? 'quality_rejection' or o.metadata ? '_quality_quarantine_reason')
  on conflict (original_id) do nothing;
  get diagnostics v_archived = row_count;

  if v_archived <> v_expected then
    raise exception 'legacy bulk reset archive count mismatch: expected %, archived %', v_expected, v_archived;
  end if;

  delete from public.price_history ph
  using public.price_history_quarantine q
  where q.original_id=ph.id
    and q.quarantine_reason='legacy_bulk_reset_quality_quarantine_61b144bb';
  get diagnostics v_deleted = row_count;

  if v_deleted <> v_expected then
    raise exception 'legacy bulk reset delete count mismatch: expected %, deleted %', v_expected, v_deleted;
  end if;
end
$$;

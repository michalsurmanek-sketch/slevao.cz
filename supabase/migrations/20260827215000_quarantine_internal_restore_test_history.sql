do $$
declare
  v_expected integer := 1;
  v_candidates integer;
  v_archived integer;
  v_deleted integer;
begin
  select count(*) into v_candidates
  from public.price_history
  where source_url = 'https://slevao.cz/internal-restore-test';

  if v_candidates <> v_expected then
    raise exception 'internal restore test history candidate count changed: expected %, got %', v_expected, v_candidates;
  end if;

  insert into public.price_history_quarantine (original_id, snapshot, quarantine_reason)
  select id, to_jsonb(ph), 'internal_restore_test_artifact'
  from public.price_history ph
  where source_url = 'https://slevao.cz/internal-restore-test'
  on conflict (original_id) do nothing;
  get diagnostics v_archived = row_count;

  if v_archived <> v_expected then
    raise exception 'internal restore test archive count mismatch: expected %, archived %', v_expected, v_archived;
  end if;

  delete from public.price_history ph
  using public.price_history_quarantine q
  where q.original_id=ph.id and q.quarantine_reason='internal_restore_test_artifact';
  get diagnostics v_deleted = row_count;

  if v_deleted <> v_expected then
    raise exception 'internal restore test delete count mismatch: expected %, deleted %', v_expected, v_deleted;
  end if;
end
$$;

alter table public.price_history
  drop constraint if exists price_history_no_internal_restore_test;

alter table public.price_history
  add constraint price_history_no_internal_restore_test
  check (coalesce(source_url, '') <> 'https://slevao.cz/internal-restore-test') not valid;

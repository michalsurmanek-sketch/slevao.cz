begin;

create table if not exists public.price_history_quarantine (
  original_id bigint primary key,
  snapshot jsonb not null,
  quarantine_reason text not null,
  quarantined_at timestamptz not null default clock_timestamp()
);

alter table public.price_history_quarantine enable row level security;
revoke all on table public.price_history_quarantine from anon, authenticated;
grant select, insert, delete on table public.price_history_quarantine to service_role;

do $$
declare
  v_expected integer := 2447;
  v_candidates integer;
  v_archived integer;
  v_deleted integer;
begin
  select count(*) into v_candidates
  from public.price_history ph
  where ph.recorded_at >= '2026-08-05 16:59:00+00'::timestamptz
    and ph.recorded_at <= '2026-08-07 12:05:00+00'::timestamptz
    and ph.valid_to = date '2026-08-11'
    and ph.source_url is null
    and ph.offer_id is null
    and ph.metadata = '{}'::jsonb;

  if v_candidates <> v_expected then
    raise exception 'price_history quarantine candidate count changed: expected %, got %', v_expected, v_candidates;
  end if;

  insert into public.price_history_quarantine (original_id, snapshot, quarantine_reason)
  select ph.id,
         to_jsonb(ph),
         'unprovenanced_leaflet_ocr_seed_2026_08_05_to_07'
  from public.price_history ph
  where ph.recorded_at >= '2026-08-05 16:59:00+00'::timestamptz
    and ph.recorded_at <= '2026-08-07 12:05:00+00'::timestamptz
    and ph.valid_to = date '2026-08-11'
    and ph.source_url is null
    and ph.offer_id is null
    and ph.metadata = '{}'::jsonb
  on conflict (original_id) do nothing;
  get diagnostics v_archived = row_count;

  if v_archived <> v_expected then
    raise exception 'price_history quarantine archive count mismatch: expected %, archived %', v_expected, v_archived;
  end if;

  delete from public.price_history ph
  using public.price_history_quarantine q
  where q.original_id = ph.id
    and q.quarantine_reason = 'unprovenanced_leaflet_ocr_seed_2026_08_05_to_07';
  get diagnostics v_deleted = row_count;

  if v_deleted <> v_expected then
    raise exception 'price_history quarantine delete count mismatch: expected %, deleted %', v_expected, v_deleted;
  end if;
end
$$;

alter table public.price_history
  drop constraint if exists price_history_direct_insert_provenance;

alter table public.price_history
  add constraint price_history_direct_insert_provenance
  check (
    offer_id is not null
    or coalesce(nullif(btrim(metadata ->> 'provenance'), ''), '') <> ''
  ) not valid;

create or replace function public.record_offer_price()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT'
     or new.price is distinct from old.price
     or new.old_price is distinct from old.old_price
     or new.product_id is distinct from old.product_id then

    insert into public.price_history (
      product_id,
      store_id,
      branch_id,
      offer_id,
      price,
      old_price,
      unit_price,
      recorded_at,
      valid_from,
      valid_to,
      source_url,
      metadata
    )
    values (
      new.product_id,
      new.store_id,
      new.branch_id,
      new.id,
      new.price,
      new.old_price,
      new.unit_price,
      clock_timestamp(),
      new.valid_from,
      new.valid_to,
      new.source_url,
      jsonb_build_object(
        'provenance', 'offer_trigger',
        'trigger', 'record_offer_price'
      )
    );
  end if;

  return new;
end;
$function$;

commit;

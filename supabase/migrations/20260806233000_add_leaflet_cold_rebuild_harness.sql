create table if not exists public.leaflet_cold_rebuild_runs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  store_slug text not null,
  status text not null default 'prepared' check (status in ('prepared','running','completed','failed','rolled_back')),
  before_offer_count integer not null default 0,
  before_import_count integer not null default 0,
  before_item_count integer not null default 0,
  after_offer_count integer not null default 0,
  after_import_count integer not null default 0,
  after_item_count integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  error_message text null,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.leaflet_cold_rebuild_offer_backup (
  run_id uuid not null references public.leaflet_cold_rebuild_runs(id) on delete cascade,
  offer_id uuid not null,
  snapshot jsonb not null,
  primary key (run_id, offer_id)
);

create table if not exists public.leaflet_cold_rebuild_import_backup (
  run_id uuid not null references public.leaflet_cold_rebuild_runs(id) on delete cascade,
  import_id uuid not null,
  snapshot jsonb not null,
  primary key (run_id, import_id)
);

create table if not exists public.leaflet_cold_rebuild_item_backup (
  run_id uuid not null references public.leaflet_cold_rebuild_runs(id) on delete cascade,
  item_id uuid not null,
  snapshot jsonb not null,
  primary key (run_id, item_id)
);

create table if not exists public.leaflet_cold_rebuild_price_history_backup (
  run_id uuid not null references public.leaflet_cold_rebuild_runs(id) on delete cascade,
  price_history_id bigint not null,
  offer_id uuid not null,
  primary key (run_id, price_history_id)
);

alter table public.leaflet_cold_rebuild_runs enable row level security;
alter table public.leaflet_cold_rebuild_offer_backup enable row level security;
alter table public.leaflet_cold_rebuild_import_backup enable row level security;
alter table public.leaflet_cold_rebuild_item_backup enable row level security;
alter table public.leaflet_cold_rebuild_price_history_backup enable row level security;

revoke all on public.leaflet_cold_rebuild_runs from anon, authenticated;
revoke all on public.leaflet_cold_rebuild_offer_backup from anon, authenticated;
revoke all on public.leaflet_cold_rebuild_import_backup from anon, authenticated;
revoke all on public.leaflet_cold_rebuild_item_backup from anon, authenticated;
revoke all on public.leaflet_cold_rebuild_price_history_backup from anon, authenticated;

create or replace function public.begin_leaflet_cold_rebuild(p_store_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_run_id uuid := gen_random_uuid();
  v_offer_count integer := 0;
  v_import_count integer := 0;
  v_item_count integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('leaflet-cold-rebuild:' || lower(trim(p_store_slug))));

  select id into v_store_id from public.stores where slug = lower(trim(p_store_slug));
  if v_store_id is null then raise exception 'Obchod % nebyl nalezen.', p_store_slug; end if;

  if exists (
    select 1 from public.leaflet_cold_rebuild_runs
    where store_id = v_store_id and status in ('prepared','running')
  ) then
    raise exception 'Pro obchod % už studený rebuild běží.', p_store_slug;
  end if;

  insert into public.leaflet_cold_rebuild_runs(id, store_id, store_slug, status)
  values (v_run_id, v_store_id, lower(trim(p_store_slug)), 'prepared');

  insert into public.leaflet_cold_rebuild_offer_backup(run_id, offer_id, snapshot)
  select v_run_id, o.id, to_jsonb(o)
  from public.offers o
  where o.store_id = v_store_id
    and o.valid_to >= current_date;
  get diagnostics v_offer_count = row_count;

  insert into public.leaflet_cold_rebuild_price_history_backup(run_id, price_history_id, offer_id)
  select v_run_id, ph.id, ph.offer_id
  from public.price_history ph
  join public.leaflet_cold_rebuild_offer_backup b
    on b.run_id = v_run_id and b.offer_id = ph.offer_id;

  insert into public.leaflet_cold_rebuild_import_backup(run_id, import_id, snapshot)
  select v_run_id, li.id, to_jsonb(li)
  from public.leaflet_imports li
  where li.store_id = v_store_id
    and (li.detected_valid_to is null or li.detected_valid_to >= current_date);
  get diagnostics v_import_count = row_count;

  insert into public.leaflet_cold_rebuild_item_backup(run_id, item_id, snapshot)
  select v_run_id, lii.id, to_jsonb(lii)
  from public.leaflet_import_items lii
  join public.leaflet_cold_rebuild_import_backup b
    on b.run_id = v_run_id and b.import_id = lii.import_id;
  get diagnostics v_item_count = row_count;

  delete from public.offers o
  using public.leaflet_cold_rebuild_offer_backup b
  where b.run_id = v_run_id and b.offer_id = o.id;

  update public.leaflet_pipeline_runs lpr
  set import_id = null
  where lpr.import_id in (
    select import_id from public.leaflet_cold_rebuild_import_backup where run_id = v_run_id
  );

  delete from public.leaflet_imports li
  using public.leaflet_cold_rebuild_import_backup b
  where b.run_id = v_run_id and b.import_id = li.id;

  update public.leaflet_cold_rebuild_runs
  set status = 'running',
      before_offer_count = v_offer_count,
      before_import_count = v_import_count,
      before_item_count = v_item_count
  where id = v_run_id;

  return jsonb_build_object(
    'ok', true,
    'run_id', v_run_id,
    'store_slug', lower(trim(p_store_slug)),
    'deleted_offers', v_offer_count,
    'deleted_imports', v_import_count,
    'deleted_items', v_item_count
  );
end;
$$;

create or replace function public.complete_leaflet_cold_rebuild(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.leaflet_cold_rebuild_runs%rowtype;
  v_offers integer;
  v_imports integer;
  v_items integer;
begin
  select * into v_run from public.leaflet_cold_rebuild_runs where id = p_run_id for update;
  if v_run.id is null then raise exception 'Cold rebuild run nebyl nalezen.'; end if;

  select count(*) into v_offers from public.offers
  where store_id = v_run.store_id and status = 'published' and valid_to >= current_date;

  select count(*) into v_imports from public.leaflet_imports
  where store_id = v_run.store_id
    and status in ('published','review','publishing')
    and (detected_valid_to is null or detected_valid_to >= current_date);

  select count(*) into v_items
  from public.leaflet_import_items lii
  join public.leaflet_imports li on li.id = lii.import_id
  where li.store_id = v_run.store_id
    and (li.detected_valid_to is null or li.detected_valid_to >= current_date);

  if v_imports < 1 then raise exception 'Po studeném rebuildu nevznikl žádný aktuální import.'; end if;
  if v_run.before_offer_count > 0 and v_offers < 1 then raise exception 'Po studeném rebuildu nevznikla žádná publikovaná nabídka.'; end if;

  update public.leaflet_cold_rebuild_runs
  set status = 'completed',
      after_offer_count = v_offers,
      after_import_count = v_imports,
      after_item_count = v_items,
      finished_at = now(),
      metadata = metadata || jsonb_build_object(
        'offer_count_difference', v_offers - before_offer_count,
        'import_count_difference', v_imports - before_import_count,
        'item_count_difference', v_items - before_item_count
      )
  where id = p_run_id;

  return jsonb_build_object(
    'ok', true,
    'run_id', p_run_id,
    'before_offers', v_run.before_offer_count,
    'after_offers', v_offers,
    'before_imports', v_run.before_import_count,
    'after_imports', v_imports,
    'before_items', v_run.before_item_count,
    'after_items', v_items
  );
end;
$$;

create or replace function public.rollback_leaflet_cold_rebuild(p_run_id uuid, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.leaflet_cold_rebuild_runs%rowtype;
  v_restored_offers integer := 0;
  v_restored_imports integer := 0;
  v_restored_items integer := 0;
begin
  select * into v_run from public.leaflet_cold_rebuild_runs where id = p_run_id for update;
  if v_run.id is null then raise exception 'Cold rebuild run nebyl nalezen.'; end if;

  delete from public.offers where store_id = v_run.store_id and created_at >= v_run.started_at;

  update public.leaflet_pipeline_runs
  set import_id = null
  where import_id in (
    select id from public.leaflet_imports where store_id = v_run.store_id and created_at >= v_run.started_at
  );
  delete from public.leaflet_imports where store_id = v_run.store_id and created_at >= v_run.started_at;

  insert into public.leaflet_imports
  select (jsonb_populate_record(null::public.leaflet_imports, b.snapshot)).*
  from public.leaflet_cold_rebuild_import_backup b
  where b.run_id = p_run_id
  on conflict (id) do nothing;
  get diagnostics v_restored_imports = row_count;

  insert into public.leaflet_import_items
  select (jsonb_populate_record(null::public.leaflet_import_items, b.snapshot)).*
  from public.leaflet_cold_rebuild_item_backup b
  where b.run_id = p_run_id
  on conflict (id) do nothing;
  get diagnostics v_restored_items = row_count;

  insert into public.offers
  select (jsonb_populate_record(null::public.offers, b.snapshot)).*
  from public.leaflet_cold_rebuild_offer_backup b
  where b.run_id = p_run_id
  on conflict (id) do nothing;
  get diagnostics v_restored_offers = row_count;

  update public.price_history ph
  set offer_id = b.offer_id
  from public.leaflet_cold_rebuild_price_history_backup b
  where b.run_id = p_run_id and b.price_history_id = ph.id;

  update public.leaflet_cold_rebuild_runs
  set status = 'rolled_back',
      error_message = left(coalesce(p_error, 'Studený rebuild byl vrácen.'), 2000),
      finished_at = now()
  where id = p_run_id;

  return jsonb_build_object(
    'ok', true,
    'run_id', p_run_id,
    'restored_offers', v_restored_offers,
    'restored_imports', v_restored_imports,
    'restored_items', v_restored_items
  );
end;
$$;

revoke all on function public.begin_leaflet_cold_rebuild(text) from public, anon, authenticated;
revoke all on function public.complete_leaflet_cold_rebuild(uuid) from public, anon, authenticated;
revoke all on function public.rollback_leaflet_cold_rebuild(uuid,text) from public, anon, authenticated;
grant execute on function public.begin_leaflet_cold_rebuild(text) to service_role;
grant execute on function public.complete_leaflet_cold_rebuild(uuid) to service_role;
grant execute on function public.rollback_leaflet_cold_rebuild(uuid,text) to service_role;
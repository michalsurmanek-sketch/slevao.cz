create table if not exists private.public_offer_search_cache_dirty_transactions (
  transaction_id text primary key,
  first_change_at timestamptz not null default clock_timestamp(),
  last_change_at timestamptz not null default clock_timestamp(),
  last_change_source text
);

revoke all on table private.public_offer_search_cache_dirty_transactions from public, anon, authenticated;

create or replace function private.mark_public_offer_search_cache_dirty()
returns trigger
language plpgsql
security definer
set search_path = 'private', 'pg_temp'
as $function$
declare
  v_transaction_id text := pg_current_xact_id()::text;
begin
  insert into private.public_offer_search_cache_dirty_transactions(
    transaction_id,
    first_change_at,
    last_change_at,
    last_change_source
  )
  values (
    v_transaction_id,
    clock_timestamp(),
    clock_timestamp(),
    concat_ws('.', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP)
  )
  on conflict (transaction_id) do update
    set last_change_at = excluded.last_change_at,
        last_change_source = excluded.last_change_source;

  return null;
end;
$function$;

revoke all on function private.mark_public_offer_search_cache_dirty() from public, anon, authenticated;

create or replace function private.refresh_public_offer_search_cache_if_dirty(p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = 'private', 'public', 'pg_temp'
as $function$
declare
  v_dirty_ids text[] := array[]::text[];
  v_dirty_count integer := 0;
  v_pending_count integer := 0;
  v_last_refreshed_version bigint := 0;
  v_start_version bigint := 0;
  v_current_version bigint := 0;
  v_started_at timestamptz;
  v_finished_at timestamptz;
  v_duration_ms numeric;
  v_last_change_at timestamptz;
  v_last_change_source text;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('slevao:public_offer_search_cache_refresh', 0)) then
    return jsonb_build_object('ok', true, 'refreshed', false, 'reason', 'already_running');
  end if;

  select last_refreshed_version
    into v_last_refreshed_version
  from private.public_offer_search_cache_refresh_state
  where id is true;

  if not found then
    insert into private.public_offer_search_cache_refresh_state(id, change_version, last_refreshed_version)
    values (true, 1, 0)
    returning last_refreshed_version into v_last_refreshed_version;
  end if;

  select coalesce(array_agg(transaction_id order by transaction_id), array[]::text[])
    into v_dirty_ids
  from private.public_offer_search_cache_dirty_transactions;

  v_dirty_count := cardinality(v_dirty_ids);

  if v_dirty_count = 0 and not p_force then
    update private.public_offer_search_cache_refresh_state
       set change_version = greatest(change_version, last_refreshed_version),
           last_checked_at = clock_timestamp(),
           skip_count = skip_count + 1
     where id is true;

    return jsonb_build_object(
      'ok', true,
      'refreshed', false,
      'reason', 'clean',
      'change_version', greatest(v_last_refreshed_version, 0),
      'last_refreshed_version', v_last_refreshed_version,
      'pending_transactions', 0
    );
  end if;

  if v_dirty_count > 0 then
    select d.last_change_at, d.last_change_source
      into v_last_change_at, v_last_change_source
    from private.public_offer_search_cache_dirty_transactions d
    where d.transaction_id = any(v_dirty_ids)
    order by d.last_change_at desc
    limit 1;
  end if;

  v_start_version := greatest(coalesce(v_last_refreshed_version, 0), 0) + greatest(v_dirty_count, 1);
  v_started_at := clock_timestamp();
  refresh materialized view concurrently private.public_offer_search_cache;
  v_finished_at := clock_timestamp();
  v_duration_ms := round((extract(epoch from (v_finished_at - v_started_at)) * 1000)::numeric, 2);

  if v_dirty_count > 0 then
    delete from private.public_offer_search_cache_dirty_transactions
     where transaction_id = any(v_dirty_ids);
  end if;

  select count(*)::integer
    into v_pending_count
  from private.public_offer_search_cache_dirty_transactions;

  if v_pending_count > 0 then
    select d.last_change_at, d.last_change_source
      into v_last_change_at, v_last_change_source
    from private.public_offer_search_cache_dirty_transactions d
    order by d.last_change_at desc
    limit 1;
  end if;

  v_current_version := v_start_version + v_pending_count;

  update private.public_offer_search_cache_refresh_state
     set change_version = v_current_version,
         last_refreshed_version = v_start_version,
         last_change_at = coalesce(v_last_change_at, last_change_at),
         last_change_source = coalesce(v_last_change_source, last_change_source),
         last_checked_at = v_finished_at,
         last_refresh_at = v_finished_at,
         last_refresh_duration_ms = v_duration_ms,
         refresh_count = refresh_count + 1
   where id is true;

  return jsonb_build_object(
    'ok', true,
    'refreshed', true,
    'duration_ms', v_duration_ms,
    'refreshed_version', v_start_version,
    'current_version', v_current_version,
    'processed_transactions', v_dirty_count,
    'pending_transactions', v_pending_count,
    'dirty_remaining', v_pending_count > 0
  );
end;
$function$;

revoke all on function private.refresh_public_offer_search_cache_if_dirty(boolean) from public, anon, authenticated;

-- Preserve the legacy numeric telemetry as a baseline. The synthetic dirty
-- transaction guarantees one full refresh after this migration commits.
update private.public_offer_search_cache_refresh_state
   set change_version = greatest(change_version, last_refreshed_version),
       last_refreshed_version = greatest(change_version, last_refreshed_version)
 where id is true;

insert into private.public_offer_search_cache_dirty_transactions(
  transaction_id,
  first_change_at,
  last_change_at,
  last_change_source
)
values (
  pg_current_xact_id()::text,
  clock_timestamp(),
  clock_timestamp(),
  'migration.public_offer_search_cache_dirty_transactions'
)
on conflict (transaction_id) do update
  set last_change_at = excluded.last_change_at,
      last_change_source = excluded.last_change_source;

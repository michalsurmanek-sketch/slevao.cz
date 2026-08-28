create or replace function private.refresh_public_offer_search_cache_if_dirty(p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = private, public, pg_temp
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
  v_last_refresh_at timestamptz;
  v_now timestamptz;
  v_settle_window interval := interval '2 minutes';
  v_max_staleness interval := interval '15 minutes';
begin
  if not pg_try_advisory_xact_lock(hashtextextended('slevao:public_offer_search_cache_refresh', 0)) then
    return jsonb_build_object('ok', true, 'refreshed', false, 'reason', 'already_running');
  end if;

  select last_refreshed_version, last_refresh_at
    into v_last_refreshed_version, v_last_refresh_at
  from private.public_offer_search_cache_refresh_state
  where id is true;

  if not found then
    insert into private.public_offer_search_cache_refresh_state(id, change_version, last_refreshed_version)
    values (true, 1, 0)
    returning last_refreshed_version, last_refresh_at
      into v_last_refreshed_version, v_last_refresh_at;
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

  v_now := clock_timestamp();

  if not p_force
     and v_dirty_count > 0
     and v_last_refresh_at is not null
     and v_last_change_at is not null
     and v_last_change_at > v_now - v_settle_window
     and v_last_refresh_at > v_now - v_max_staleness then
    update private.public_offer_search_cache_refresh_state
       set last_checked_at = v_now,
           last_change_at = coalesce(v_last_change_at, last_change_at),
           last_change_source = coalesce(v_last_change_source, last_change_source),
           skip_count = skip_count + 1
     where id is true;

    return jsonb_build_object(
      'ok', true,
      'refreshed', false,
      'reason', 'settling',
      'pending_transactions', v_dirty_count,
      'last_change_at', v_last_change_at,
      'last_refresh_at', v_last_refresh_at,
      'settle_seconds', extract(epoch from v_settle_window)::integer,
      'max_staleness_seconds', extract(epoch from v_max_staleness)::integer,
      'force_refresh_at', v_last_refresh_at + v_max_staleness
    );
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

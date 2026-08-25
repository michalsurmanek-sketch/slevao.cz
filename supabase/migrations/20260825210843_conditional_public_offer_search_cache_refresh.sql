create table if not exists private.public_offer_search_cache_refresh_state (
  id boolean primary key default true check (id),
  change_version bigint not null default 1,
  last_refreshed_version bigint not null default 0,
  last_change_at timestamptz not null default now(),
  last_change_source text,
  last_checked_at timestamptz,
  last_refresh_at timestamptz,
  last_refresh_duration_ms numeric,
  refresh_count bigint not null default 0,
  skip_count bigint not null default 0
);

insert into private.public_offer_search_cache_refresh_state(id)
values (true)
on conflict (id) do nothing;

revoke all on table private.public_offer_search_cache_refresh_state from public, anon, authenticated;

create or replace function private.mark_public_offer_search_cache_dirty()
returns trigger
language plpgsql
security definer
set search_path = 'private', 'pg_temp'
as $function$
begin
  update private.public_offer_search_cache_refresh_state
     set change_version = change_version + 1,
         last_change_at = clock_timestamp(),
         last_change_source = concat_ws('.', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP)
   where id is true;
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
  v_start_version bigint;
  v_last_refreshed_version bigint;
  v_current_version bigint;
  v_started_at timestamptz;
  v_finished_at timestamptz;
  v_duration_ms numeric;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('slevao:public_offer_search_cache_refresh', 0)) then
    return jsonb_build_object('ok', true, 'refreshed', false, 'reason', 'already_running');
  end if;

  select change_version, last_refreshed_version
    into v_start_version, v_last_refreshed_version
  from private.public_offer_search_cache_refresh_state
  where id is true;

  if not found then
    insert into private.public_offer_search_cache_refresh_state(id, change_version, last_refreshed_version)
    values (true, 1, 0)
    returning change_version, last_refreshed_version
      into v_start_version, v_last_refreshed_version;
  end if;

  update private.public_offer_search_cache_refresh_state
     set last_checked_at = clock_timestamp()
   where id is true;

  if not p_force and v_start_version <= v_last_refreshed_version then
    update private.public_offer_search_cache_refresh_state
       set skip_count = skip_count + 1
     where id is true;
    return jsonb_build_object(
      'ok', true,
      'refreshed', false,
      'reason', 'clean',
      'change_version', v_start_version,
      'last_refreshed_version', v_last_refreshed_version
    );
  end if;

  v_started_at := clock_timestamp();
  refresh materialized view concurrently private.public_offer_search_cache;
  v_finished_at := clock_timestamp();
  v_duration_ms := round((extract(epoch from (v_finished_at - v_started_at)) * 1000)::numeric, 2);

  update private.public_offer_search_cache_refresh_state
     set last_refreshed_version = v_start_version,
         last_refresh_at = v_finished_at,
         last_refresh_duration_ms = v_duration_ms,
         refresh_count = refresh_count + 1
   where id is true;

  select change_version into v_current_version
  from private.public_offer_search_cache_refresh_state
  where id is true;

  return jsonb_build_object(
    'ok', true,
    'refreshed', true,
    'duration_ms', v_duration_ms,
    'refreshed_version', v_start_version,
    'current_version', v_current_version,
    'dirty_remaining', v_current_version > v_start_version
  );
end;
$function$;

revoke all on function private.refresh_public_offer_search_cache_if_dirty(boolean) from public, anon, authenticated;

drop trigger if exists trg_public_offer_search_cache_dirty_offers on public.offers;
create trigger trg_public_offer_search_cache_dirty_offers
after insert or update or delete or truncate on public.offers
for each statement execute function private.mark_public_offer_search_cache_dirty();

drop trigger if exists trg_public_offer_search_cache_dirty_products on public.products;
create trigger trg_public_offer_search_cache_dirty_products
after insert or update or delete or truncate on public.products
for each statement execute function private.mark_public_offer_search_cache_dirty();

drop trigger if exists trg_public_offer_search_cache_dirty_stores on public.stores;
create trigger trg_public_offer_search_cache_dirty_stores
after insert or update or delete or truncate on public.stores
for each statement execute function private.mark_public_offer_search_cache_dirty();

drop trigger if exists trg_public_offer_search_cache_dirty_categories on public.categories;
create trigger trg_public_offer_search_cache_dirty_categories
after insert or update or delete or truncate on public.categories
for each statement execute function private.mark_public_offer_search_cache_dirty();

do $cron$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname='refresh-public-offer-search-cache'
  order by jobid
  limit 1;

  if v_job_id is null then
    perform cron.schedule(
      'refresh-public-offer-search-cache',
      '*/5 * * * *',
      'select private.refresh_public_offer_search_cache_if_dirty(false);'
    );
  else
    perform cron.alter_job(
      job_id := v_job_id,
      command := 'select private.refresh_public_offer_search_cache_if_dirty(false);'
    );
  end if;
end;
$cron$;

create or replace function private.reconcile_expected_waiting_source_errors()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_catalog'
as $function$
declare
  v_updated integer := 0;
begin
  with candidates as (
    select ls.id, s.slug
    from public.leaflet_sources ls
    join public.stores s on s.id = ls.store_id
    join public.store_product_sync_state st on st.store_id = s.id
    where ls.is_active = true
      and st.health_status = 'waiting_source'
      and (
        (s.slug = 'dr-max' and ls.last_error ilike '%označuje aktuální leták jako ukončený%')
        or
        (s.slug = 'pro-doma' and ls.last_error ilike '%nemá žádný aktuální import%')
      )
  ), updated as (
    update public.leaflet_sources ls
    set last_error = null,
        last_success_at = coalesce(ls.last_checked_at, ls.last_success_at),
        last_strategy_used = case
          when c.slug = 'dr-max' then 'official_triobo_waiting_source'
          when c.slug = 'pro-doma' then 'staged-pro-doma-waiting-source'
          else ls.last_strategy_used
        end,
        last_strategy_success_at = coalesce(ls.last_checked_at, ls.last_strategy_success_at),
        updated_at = now()
    from candidates c
    where ls.id = c.id
    returning ls.id
  )
  select count(*)::integer into v_updated from updated;

  return jsonb_build_object('ok', true, 'normalized_sources', v_updated);
end;
$function$;

do $block$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'reconcile-product-health-floor' limit 1;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
  perform cron.schedule(
    'reconcile-product-health-floor',
    '*/5 * * * *',
    'select private.reconcile_product_health_floor(); select private.reconcile_expected_waiting_source_errors();'
  );
end;
$block$;

select private.reconcile_expected_waiting_source_errors();
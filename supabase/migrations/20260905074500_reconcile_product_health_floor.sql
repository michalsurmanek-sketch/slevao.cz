create or replace function private.reconcile_product_health_floor()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_catalog'
as $function$
declare
  r record;
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_active integer;
  v_from date;
  v_to date;
  v_minimum integer;
  v_updated integer := 0;
  v_degraded integer := 0;
  v_waiting integer := 0;
begin
  for r in
    select st.store_id, s.slug, s.name, st.minimum_offer_count, st.last_valid_to
    from public.store_product_sync_state st
    join public.stores s on s.id = st.store_id
    where st.health_status = 'ok'
      and st.is_running is not true
  loop
    select count(*)::integer, min(o.valid_from), max(o.valid_to)
      into v_active, v_from, v_to
    from public.offers o
    where o.store_id = r.store_id
      and o.status = 'published'
      and o.is_verified = true
      and o.valid_from <= v_today
      and o.valid_to >= v_today;

    v_minimum := greatest(coalesce(r.minimum_offer_count, 1), 1);

    if v_active >= v_minimum then
      continue;
    end if;

    if v_active > 0 then
      update public.store_product_sync_state st
      set health_status = 'degraded',
          health_reason = format('%s: pouze %s aktuálních ověřených nabídek; nastavené minimum je %s.', r.name, v_active, v_minimum),
          last_offer_count = v_active,
          last_published_count = v_active,
          last_valid_from = v_from,
          last_valid_to = v_to,
          metadata = coalesce(st.metadata, '{}'::jsonb) || jsonb_build_object(
            'health_floor_reconciler', 'v1',
            'health_floor_reconciled_at', now(),
            'active_verified_offer_count', v_active,
            'minimum_offer_count', v_minimum
          ),
          updated_at = now()
      where st.store_id = r.store_id;
      v_degraded := v_degraded + 1;
    else
      update public.store_product_sync_state st
      set health_status = 'waiting_source',
          health_reason = case
            when r.last_valid_to is not null and r.last_valid_to < v_today
              then format('%s: poslední ověřená nabídka skončila %s; čeká se na novou aktuální kampaň.', r.name, to_char(r.last_valid_to, 'DD.MM.YYYY'))
            else format('%s: dnes nejsou žádné aktuální ověřené nabídky; čeká se na aktuální zdroj.', r.name)
          end,
          last_offer_count = 0,
          last_published_count = 0,
          metadata = coalesce(st.metadata, '{}'::jsonb) || jsonb_build_object(
            'health_floor_reconciler', 'v1',
            'health_floor_reconciled_at', now(),
            'active_verified_offer_count', 0,
            'minimum_offer_count', v_minimum
          ),
          updated_at = now()
      where st.store_id = r.store_id;
      v_waiting := v_waiting + 1;
    end if;

    v_updated := v_updated + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'date', v_today,
    'updated_stores', v_updated,
    'degraded', v_degraded,
    'waiting_source', v_waiting
  );
end;
$function$;

create or replace function private.refresh_obi_health()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare
  v_store_id uuid;
  v_count integer := 0;
  v_docs integer := 0;
  v_from date;
  v_to date;
  v_status text;
  v_reason text;
  v_minimum integer := 1;
  v_now timestamptz := now();
  v_today date := (now() at time zone 'Europe/Prague')::date;
begin
  select id into v_store_id from public.stores where slug = 'obi';
  if v_store_id is null then return jsonb_build_object('ok', false, 'error', 'OBI store missing'); end if;

  select greatest(coalesce(minimum_offer_count, 1), 1)
    into v_minimum
  from public.store_product_sync_state
  where store_id = v_store_id;
  v_minimum := coalesce(v_minimum, 1);

  select count(*)::integer, min(valid_from), max(valid_to)
    into v_count, v_from, v_to
  from public.offers
  where store_id = v_store_id
    and status = 'published'
    and is_verified = true
    and valid_from <= v_today
    and valid_to >= v_today;

  select count(*)::integer into v_docs
  from public.leaflet_imports
  where store_id = v_store_id
    and metadata->>'adapter' = 'obi-bonial-v1'
    and detected_valid_from <= v_today
    and detected_valid_to >= v_today
    and status in ('published', 'review');

  if v_count >= v_minimum then
    v_status := 'ok';
    v_reason := format('OBI: %s aktuálních ověřených nabídek; minimum %s splněno.', v_count, v_minimum);
  elsif v_count > 0 then
    v_status := 'degraded';
    v_reason := format('OBI: pouze %s aktuálních ověřených nabídek; nastavené minimum je %s.', v_count, v_minimum);
  elsif v_docs > 0 then
    v_status := 'degraded';
    v_reason := 'OBI: aktuální oficiální Bonial brožura je dostupná, ale bezpečný parser v ní nemá aktuální cenové nabídky.';
  else
    v_status := 'waiting_source';
    v_reason := 'OBI: čeká se na nový aktuální oficiální Bonial leták.';
  end if;

  insert into public.store_product_sync_state(
    store_id,last_run_at,last_success_at,last_offer_count,expected_offer_count,last_published_count,last_valid_from,last_valid_to,
    last_error,last_parser_error,health_status,health_reason,is_running,run_started_at,parser_version,adapter_name,adapter_version,
    source_type,source_category,coverage_scope,updated_at
  ) values(
    v_store_id,v_now,case when v_count > 0 then v_now else null end,v_count,greatest(v_count,v_minimum),v_count,v_from,v_to,
    null,null,v_status,v_reason,false,null,'obi-pdf-spatial-v1','obi-spatial-official','v1',
    'official-pdf-text+product-page','current-leaflet','national',v_now
  ) on conflict(store_id) do update set
    last_run_at = excluded.last_run_at,
    last_success_at = coalesce(excluded.last_success_at, public.store_product_sync_state.last_success_at),
    last_offer_count = excluded.last_offer_count,
    expected_offer_count = excluded.expected_offer_count,
    last_published_count = excluded.last_published_count,
    last_valid_from = excluded.last_valid_from,
    last_valid_to = excluded.last_valid_to,
    last_error = null,
    last_parser_error = null,
    health_status = excluded.health_status,
    health_reason = excluded.health_reason,
    is_running = false,
    run_started_at = null,
    parser_version = excluded.parser_version,
    adapter_name = excluded.adapter_name,
    adapter_version = excluded.adapter_version,
    source_type = excluded.source_type,
    source_category = excluded.source_category,
    coverage_scope = excluded.coverage_scope,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'current_offers', v_count,
    'current_documents', v_docs,
    'minimum_offer_count', v_minimum,
    'health_status', v_status
  );
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
    'select private.reconcile_product_health_floor();'
  );
end;
$block$;

select private.refresh_obi_health();
select private.reconcile_product_health_floor();
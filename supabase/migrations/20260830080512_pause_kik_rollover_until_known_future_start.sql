create or replace function public.normalize_kik_future_rollover_health()
returns trigger
language plpgsql
set search_path to 'public','pg_catalog'
as $function$
declare
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_current_count integer := 0;
  v_future_from date;
begin
  if new.health_reason like 'Nový KiK leták začne platit %'
     and exists (
       select 1 from public.stores s
       where s.id=new.store_id and s.slug='kik'
     )
  then
    if new.health_reason ~ 'Nový KiK leták začne platit [0-9]{4}-[0-9]{2}-[0-9]{2}' then
      v_future_from := substring(new.health_reason from '([0-9]{4}-[0-9]{2}-[0-9]{2})')::date;
    end if;

    select count(*)
    into v_current_count
    from public.offers o
    where o.store_id=new.store_id
      and o.status='published'
      and o.valid_from<=v_today
      and o.valid_to>=v_today;

    new.last_offer_count := v_current_count;
    new.last_published_count := v_current_count;
    new.last_success_at := coalesce(new.last_success_at, now());
    if v_future_from is not null then
      new.last_valid_from := v_future_from;
    end if;

    if v_current_count=0 then
      new.health_status := 'waiting_source';
      new.health_reason := replace(
        new.health_reason,
        'současné veřejné nabídky zůstávají beze změny.',
        'dnes nejsou platné KiK nabídky; čeká se na začátek nové platnosti.'
      );
    else
      new.health_status := 'ok';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.run_rollover_supervisor()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $function$
declare
  t record;
  v_store_id uuid;
  v_now timestamptz := now();
  v_local timestamp := now() at time zone 'Europe/Prague';
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_tomorrow date := ((now() at time zone 'Europe/Prague')::date + 1);
  v_today_count integer;
  v_tomorrow_count integer;
  v_health_status text;
  v_state_valid_from date;
  v_due boolean;
  v_reason text;
  v_request bigint;
  v_triggered jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_failed jsonb := '[]'::jsonb;
begin
  for t in
    select * from private.rollover_sync_targets where enabled order by store_slug
  loop
    select id into v_store_id from public.stores where slug=t.store_slug limit 1;
    if v_store_id is null then
      v_failed := v_failed || jsonb_build_array(jsonb_build_object('store',t.store_slug,'error','store_not_found'));
      continue;
    end if;

    select st.health_status,st.last_valid_from
      into v_health_status,v_state_valid_from
    from public.store_product_sync_state st
    where st.store_id=v_store_id;

    select
      count(*) filter(where status='published' and valid_from<=v_today and valid_to>=v_today),
      count(*) filter(where status='published' and valid_from<=v_tomorrow and valid_to>=v_tomorrow)
    into v_today_count,v_tomorrow_count
    from public.offers
    where store_id=v_store_id;

    if t.store_slug='kik'
       and v_health_status='waiting_source'
       and v_state_valid_from is not null
       and v_state_valid_from>v_today then
      v_reason := format('known_future_publication:%s',v_state_valid_from);
      update private.rollover_sync_targets
         set last_status='waiting_future',last_reason=v_reason,updated_at=v_now
       where store_slug=t.store_slug;
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'store',t.store_slug,'today',v_today_count,'tomorrow',v_tomorrow_count,
        'reason',v_reason
      ));
      continue;
    end if;

    v_due := false;
    v_reason := null;

    if t.mode in ('daily_snapshot','current_day') then
      if v_today_count < t.min_today_offers then
        v_due := true;
        v_reason := format('today_below_threshold:%s<%s',v_today_count,t.min_today_offers);
      end if;
    elsif t.mode in ('next_day_prefetch','source_refresh') then
      if v_today_count < t.min_today_offers then
        v_due := true;
        v_reason := format('today_below_threshold:%s<%s',v_today_count,t.min_today_offers);
      elsif v_local::time >= t.prefetch_after and v_tomorrow_count < t.min_tomorrow_offers then
        v_due := true;
        v_reason := format('tomorrow_below_threshold:%s<%s',v_tomorrow_count,t.min_tomorrow_offers);
      end if;
    end if;

    if not v_due then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('store',t.store_slug,'today',v_today_count,'tomorrow',v_tomorrow_count,'reason','healthy'));
      continue;
    end if;

    if t.last_triggered_at is not null and t.last_triggered_at > v_now - t.cooldown then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('store',t.store_slug,'today',v_today_count,'tomorrow',v_tomorrow_count,'reason','cooldown'));
      continue;
    end if;

    update private.rollover_sync_targets
      set last_triggered_at=v_now,last_status='running',last_reason=v_reason,updated_at=v_now
      where store_slug=t.store_slug;

    begin
      v_request := null;
      case t.action
        when 'penny_structured' then
          v_request := public.trigger_penny_structured_sync();
        when 'billa_publitas' then
          v_request := public.invoke_billa_publitas_sync();
        when 'flop_verified' then
          v_request := public.trigger_flop_top_verified_sync();
        when 'terno_source' then
          v_request := private.invoke_edge_function('sync-terno-source','{}'::jsonb,120000);
        when 'jip_source' then
          v_request := private.invoke_edge_function('sync-jip-source','{}'::jsonb,120000);
        when 'coop_source' then
          v_request := private.invoke_edge_function('sync-coop-source','{}'::jsonb,120000);
          perform public.trigger_coop_verified_sync();
        when 'kik_source' then
          v_request := private.invoke_edge_function('sync-kik-source','{}'::jsonb,120000);
          perform public.trigger_kik_product_sync(false,false);
        when 'action_rollover' then
          perform public.invoke_action_source_sync();
          v_request := public.invoke_action_products_sync();
        when 'auto_kelly' then
          v_request := private.invoke_edge_function('sync-auto-kelly-products','{}'::jsonb,120000);
        when 'xxxlutz' then
          v_request := public.trigger_xxxlutz_verified_sync();
          perform public.reconcile_xxxlutz_verified_sync();
        when 'moebelix' then
          v_request := public.trigger_moebelix_verified_sync();
          perform public.reconcile_moebelix_verified_sync();
        when 'benu_pipeline' then
          v_request := private.invoke_edge_function('run-leaflet-pipeline-v2',jsonb_build_object('store_slug','benu'),120000);
        else
          raise exception 'Unknown rollover action: %',t.action;
      end case;

      update private.rollover_sync_targets
        set last_request_id=v_request,last_status='triggered',last_reason=v_reason,updated_at=now()
        where store_slug=t.store_slug;

      v_triggered := v_triggered || jsonb_build_array(jsonb_build_object(
        'store',t.store_slug,'action',t.action,'request_id',v_request,
        'today',v_today_count,'tomorrow',v_tomorrow_count,'reason',v_reason
      ));
    exception when others then
      update private.rollover_sync_targets
        set last_status='error',last_reason=left(sqlerrm,1000),updated_at=now()
        where store_slug=t.store_slug;
      v_failed := v_failed || jsonb_build_array(jsonb_build_object('store',t.store_slug,'action',t.action,'error',sqlerrm));
    end;
  end loop;

  return jsonb_build_object(
    'ok',jsonb_array_length(v_failed)=0,
    'local_time',v_local,
    'today',v_today,
    'tomorrow',v_tomorrow,
    'triggered',v_triggered,
    'skipped',v_skipped,
    'failed',v_failed
  );
end;
$function$;

update public.store_product_sync_state st
set health_reason=st.health_reason
from public.stores s
where s.id=st.store_id and s.slug='kik';
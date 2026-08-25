create table if not exists private.rollover_sync_targets (
  store_slug text primary key,
  mode text not null check (mode in ('daily_snapshot','current_day','next_day_prefetch','source_refresh')),
  action text not null,
  min_today_offers integer not null default 1 check (min_today_offers >= 0),
  min_tomorrow_offers integer not null default 1 check (min_tomorrow_offers >= 0),
  prefetch_after time without time zone not null default '16:00',
  cooldown interval not null default interval '15 minutes',
  enabled boolean not null default true,
  last_triggered_at timestamptz,
  last_request_id bigint,
  last_status text,
  last_reason text,
  updated_at timestamptz not null default now()
);

insert into private.rollover_sync_targets(store_slug,mode,action,min_today_offers,min_tomorrow_offers,prefetch_after,cooldown,enabled)
values
  ('penny','next_day_prefetch','penny_structured',20,20,'16:00',interval '15 minutes',true),
  ('billa','next_day_prefetch','billa_publitas',20,20,'16:00',interval '30 minutes',true),
  ('flop','next_day_prefetch','flop_verified',25,25,'16:00',interval '15 minutes',true),
  ('terno','source_refresh','terno_source',1,1,'16:00',interval '30 minutes',true),
  ('jip','source_refresh','jip_source',1,1,'16:00',interval '30 minutes',true),
  ('coop','source_refresh','coop_source',1,1,'16:00',interval '30 minutes',true),
  ('kik','source_refresh','kik_source',1,1,'16:00',interval '30 minutes',true),
  ('action','current_day','action_rollover',20,0,'00:00',interval '10 minutes',true),
  ('auto-kelly','daily_snapshot','auto_kelly',5,0,'00:00',interval '15 minutes',true),
  ('xxxlutz','daily_snapshot','xxxlutz',4,0,'00:00',interval '15 minutes',true),
  ('moebelix','daily_snapshot','moebelix',60,0,'00:00',interval '15 minutes',true),
  ('benu','daily_snapshot','benu_pipeline',20,0,'00:00',interval '15 minutes',true)
on conflict(store_slug) do update set
  mode=excluded.mode,
  action=excluded.action,
  min_today_offers=excluded.min_today_offers,
  min_tomorrow_offers=excluded.min_tomorrow_offers,
  prefetch_after=excluded.prefetch_after,
  cooldown=excluded.cooldown,
  enabled=excluded.enabled,
  updated_at=now();

create or replace function public.run_rollover_supervisor()
returns jsonb
language plpgsql
security definer
set search_path = 'public','private','pg_temp'
as $$
declare
  t record;
  v_store_id uuid;
  v_now timestamptz := now();
  v_local timestamp := now() at time zone 'Europe/Prague';
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_tomorrow date := ((now() at time zone 'Europe/Prague')::date + 1);
  v_today_count integer;
  v_tomorrow_count integer;
  v_due boolean;
  v_reason text;
  v_request bigint;
  v_triggered jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_failed jsonb := '[]'::jsonb;
begin
  for t in select * from private.rollover_sync_targets where enabled order by store_slug loop
    select id into v_store_id from public.stores where slug=t.store_slug limit 1;
    if v_store_id is null then
      v_failed := v_failed || jsonb_build_array(jsonb_build_object('store',t.store_slug,'error','store_not_found'));
      continue;
    end if;

    select
      count(*) filter(where status='published' and valid_from<=v_today and valid_to>=v_today),
      count(*) filter(where status='published' and valid_from<=v_tomorrow and valid_to>=v_tomorrow)
    into v_today_count,v_tomorrow_count
    from public.offers
    where store_id=v_store_id;

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
        when 'penny_structured' then v_request := public.trigger_penny_structured_sync();
        when 'billa_publitas' then v_request := public.invoke_billa_publitas_sync();
        when 'flop_verified' then v_request := public.trigger_flop_top_verified_sync();
        when 'terno_source' then v_request := private.invoke_edge_function('sync-terno-source','{}'::jsonb,120000);
        when 'jip_source' then v_request := private.invoke_edge_function('sync-jip-source','{}'::jsonb,120000);
        when 'coop_source' then
          v_request := private.invoke_edge_function('sync-coop-source','{}'::jsonb,120000);
          perform public.trigger_coop_verified_sync();
        when 'kik_source' then
          v_request := private.invoke_edge_function('sync-kik-source','{}'::jsonb,120000);
          perform public.trigger_kik_product_sync(false,false);
        when 'action_rollover' then
          perform public.invoke_action_source_sync();
          v_request := public.invoke_action_products_sync();
        when 'auto_kelly' then v_request := private.invoke_edge_function('sync-auto-kelly-products','{}'::jsonb,120000);
        when 'xxxlutz' then
          v_request := public.trigger_xxxlutz_verified_sync();
          perform public.reconcile_xxxlutz_verified_sync();
        when 'moebelix' then
          v_request := public.trigger_moebelix_verified_sync();
          perform public.reconcile_moebelix_verified_sync();
        when 'benu_pipeline' then v_request := private.invoke_edge_function('run-leaflet-pipeline-v2',jsonb_build_object('store_slug','benu'),120000);
        else raise exception 'Unknown rollover action: %',t.action;
      end case;

      update private.rollover_sync_targets
        set last_request_id=v_request,last_status='triggered',last_reason=v_reason,updated_at=now()
        where store_slug=t.store_slug;

      v_triggered := v_triggered || jsonb_build_array(jsonb_build_object('store',t.store_slug,'action',t.action,'request_id',v_request,'today',v_today_count,'tomorrow',v_tomorrow_count,'reason',v_reason));
    exception when others then
      update private.rollover_sync_targets
        set last_status='error',last_reason=left(sqlerrm,1000),updated_at=now()
        where store_slug=t.store_slug;
      v_failed := v_failed || jsonb_build_array(jsonb_build_object('store',t.store_slug,'action',t.action,'error',sqlerrm));
    end;
  end loop;

  return jsonb_build_object('ok',jsonb_array_length(v_failed)=0,'local_time',v_local,'today',v_today,'tomorrow',v_tomorrow,'triggered',v_triggered,'skipped',v_skipped,'failed',v_failed);
end;
$$;

revoke all on function public.run_rollover_supervisor() from public, anon, authenticated;
grant execute on function public.run_rollover_supervisor() to service_role;

select cron.unschedule(jobid) from cron.job where jobname='slevao-rollover-supervisor';
select cron.schedule('slevao-rollover-supervisor','*/5 * * * *','select public.run_rollover_supervisor();');

do $$
declare
  v_def text;
  v_old text := $old$        when 'jip_source' then
          v_request := private.invoke_edge_function('sync-jip-source','{}'::jsonb,120000);
        when 'coop_source' then$old$;
  v_new text := $new$        when 'jip_source' then
          v_request := private.invoke_edge_function('sync-jip-source','{}'::jsonb,120000);
        when 'lidl_rollover' then
          v_request := private.invoke_edge_function('discover-leaflets',jsonb_build_object('store_slug','lidl','force',true),120000);
          perform public.trigger_lidl_verified_sync();
        when 'coop_source' then$new$;
begin
  v_def := pg_get_functiondef('public.run_rollover_supervisor()'::regprocedure);
  if strpos(v_def,v_old)=0 then
    raise exception 'Lidl rollover patch anchor not found';
  end if;
  execute replace(v_def,v_old,v_new);
end;
$$;

insert into private.rollover_sync_targets(
  store_slug,mode,action,min_today_offers,min_tomorrow_offers,prefetch_after,cooldown,enabled,last_status,last_reason,updated_at
)
values(
  'lidl','next_day_prefetch','lidl_rollover',25,25,'16:00'::time,'15 minutes'::interval,true,'configured','force_discovery_before_rollover',now()
)
on conflict(store_slug) do update set
  mode=excluded.mode,
  action=excluded.action,
  min_today_offers=excluded.min_today_offers,
  min_tomorrow_offers=excluded.min_tomorrow_offers,
  prefetch_after=excluded.prefetch_after,
  cooldown=excluded.cooldown,
  enabled=excluded.enabled,
  updated_at=now();

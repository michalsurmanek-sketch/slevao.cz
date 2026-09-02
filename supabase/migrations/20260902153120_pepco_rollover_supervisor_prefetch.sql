do $$
declare
  v_def text;
  v_old text := $old$        when 'benu_pipeline' then
          v_request := private.invoke_edge_function('run-leaflet-pipeline-v2',jsonb_build_object('store_slug','benu'),120000);
        else$old$;
  v_new text := $new$        when 'benu_pipeline' then
          v_request := private.invoke_edge_function('run-leaflet-pipeline-v2',jsonb_build_object('store_slug','benu'),120000);
        when 'pepco_pipeline' then
          v_request := private.invoke_edge_function('run-leaflet-pipeline-v2',jsonb_build_object('store_slug','pepco'),120000);
        else$new$;
begin
  v_def := pg_get_functiondef('public.run_rollover_supervisor()'::regprocedure);
  if strpos(v_def,v_old)=0 then
    raise exception 'Pepco rollover patch anchor not found';
  end if;
  v_def := replace(v_def,v_old,v_new);
  execute v_def;
end;
$$;

insert into private.rollover_sync_targets(
  store_slug,
  mode,
  action,
  min_today_offers,
  min_tomorrow_offers,
  prefetch_after,
  cooldown,
  enabled,
  last_status,
  last_reason,
  updated_at
)
values(
  'pepco',
  'next_day_prefetch',
  'pepco_pipeline',
  10,
  10,
  '22:00'::time,
  '30 minutes'::interval,
  true,
  'configured',
  'weekly_rollover_prefetch',
  now()
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

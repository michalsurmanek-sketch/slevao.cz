do $$
declare
  v_def text;
  v_old text := $old$        when 'auto_kelly' then
          v_request := private.invoke_edge_function('sync-auto-kelly-products','{}'::jsonb,120000);
        when 'xxxlutz' then$old$;
  v_new text := $new$        when 'auto_kelly' then
          v_request := private.invoke_edge_function('sync-auto-kelly-products','{}'::jsonb,120000);
        when 'ikea' then
          v_request := private.invoke_edge_function('sync-ikea-products',jsonb_build_object('dry_run',false),120000);
        when 'xxxlutz' then$new$;
begin
  v_def := pg_get_functiondef('public.run_rollover_supervisor()'::regprocedure);
  if strpos(v_def,v_old)=0 then
    raise exception 'IKEA rollover patch anchor not found';
  end if;
  execute replace(v_def,v_old,v_new);
end;
$$;

insert into private.rollover_sync_targets(
  store_slug,mode,action,min_today_offers,min_tomorrow_offers,prefetch_after,cooldown,enabled,last_status,last_reason,updated_at
)
values(
  'ikea','next_day_prefetch','ikea',10,10,'16:00'::time,'30 minutes'::interval,true,'configured','daily_snapshot_retry',now()
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

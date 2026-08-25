do $migration$
declare
  v_oid oid;
  v_def text;
  v_before text;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='trigger_flop_top_verified_sync';
  if v_oid is null then raise exception 'trigger_flop_top_verified_sync is missing'; end if;

  v_def := pg_get_functiondef(v_oid);
  v_before := v_def;
  v_def := replace(
    v_def,
    $old$health_status='degraded',
           health_reason=format('Publikováno %s matematicky ověřených FLOP TOP nabídek pro %s.',v_target_count,v_target_date)$old$,
    $new$health_status='ok',
           health_reason=format('Publikováno %s matematicky ověřených FLOP TOP nabídek pro %s.',v_target_count,v_target_date)$new$
  );

  if v_def = v_before or v_def not like '%health_status=''ok''%' then
    raise exception 'FLOP success health patch did not apply';
  end if;
  execute v_def;
end
$migration$;

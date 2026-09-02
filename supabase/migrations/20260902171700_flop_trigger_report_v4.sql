-- Keep FLOP health metadata aligned with the active spatial parser generation.

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='trigger_flop_top_verified_sync'
    and p.prokind='f'
  limit 1;

  if v_def is null then
    raise exception 'trigger_flop_top_verified_sync not found';
  end if;

  v_def := replace(v_def, $old$parser_version='flop-pdf-spatial-unit-price-v3'$old$, $new$parser_version='flop-pdf-spatial-unit-price-v4'$new$);
  v_def := replace(v_def, $old$adapter_version='v3'$old$, $new$adapter_version='v4'$new$);

  execute v_def;
end
$$;

-- FLOP changed the national flyer filename from *_tisk_nahled_s.pdf / *_online.pdf
-- to e.g. 36_26_S.pdf. Keep Flop_A_ regional documents excluded while allowing
-- the new official national suffix and preserving ISO-week fallback parsing.

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

  v_def := replace(
    v_def,
    $old$source_document_url ~ '/[0-9]+_[0-9]+_(tisk_nahled_s|online)[.]pdf$'$old$,
    $new$source_document_url ~* '/[0-9]+_[0-9]+_(tisk_nahled_s|online|s)[.]pdf$'$new$
  );
  v_def := replace(
    v_def,
    $old$'/[0-9]{1,2}_([0-9]{2})_(?:tisk_nahled_s|online)[.]pdf$'$old$,
    $new$'/[0-9]{1,2}_([0-9]{2})_(?:tisk_nahled_s|online|[sS])[.]pdf$'$new$
  );
  v_def := replace(
    v_def,
    $old$'/([0-9]{1,2})_[0-9]{2}_(?:tisk_nahled_s|online)[.]pdf$'$old$,
    $new$'/([0-9]{1,2})_[0-9]{2}_(?:tisk_nahled_s|online|[sS])[.]pdf$'$new$
  );

  execute v_def;
end
$$;

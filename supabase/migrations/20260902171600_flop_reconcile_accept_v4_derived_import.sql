-- The FLOP spatial parser now publishes derived imports using the v4 payload contract
-- and a payload hash based source_hash. Reconcile by the explicit source_import_id
-- provenance instead of the obsolete v3 source_hash naming convention.

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='reconcile_flop_top_verified_sync'
    and p.prokind='f'
  limit 1;

  if v_def is null then
    raise exception 'reconcile_flop_top_verified_sync not found';
  end if;

  v_def := replace(
    v_def,
    $old$and li.source_hash='flop-pdf-spatial-safe-v3-'||v_source_import_id::text
    limit 1;$old$,
    $new$and coalesce(li.metadata->>'source_import_id','')=v_source_import_id::text
      and coalesce(li.metadata->>'payload_contract',li.metadata->>'full_payload_hash_version','') in ('flop-pdf-spatial-safe-v4','flop-pdf-spatial-safe-v3')
    order by case when coalesce(li.metadata->>'payload_contract',li.metadata->>'full_payload_hash_version','')='flop-pdf-spatial-safe-v4' then 0 else 1 end,
             li.updated_at desc nulls last,
             li.created_at desc
    limit 1;$new$
  );

  v_def := replace(v_def, $old$parser_version='flop-pdf-spatial-unit-price-v3'$old$, $new$parser_version='flop-pdf-spatial-unit-price-v4'$new$);
  v_def := replace(v_def, $old$adapter_version='v3'$old$, $new$adapter_version='v4'$new$);

  execute v_def;
end
$$;

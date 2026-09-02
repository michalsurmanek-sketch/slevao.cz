do $migration$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  -- Lidl parser: normalize printed 100 g / 100 ml unit prices to the public kg / l contract.
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='parse_lidl_verified_markdown'
  limit 1;

  v_old := E'  price,\n  printed_unit_price,\n  p_valid_from,';
  v_new := E'  price,\n  case\n    when um[1] ~* ''^100\\s*(g|ml)'' then printed_unit_price * 10\n    else printed_unit_price\n  end,\n  p_valid_from,';
  if strpos(v_def,v_old)=0 then
    raise exception 'Lidl parser unit-price return fragment not found';
  end if;
  v_def := replace(v_def,v_old,v_new);

  v_old := E'    ''printed_unit_price'',printed_unit_price,\n    ''coverage_note''';
  v_new := E'    ''printed_unit_price'',printed_unit_price,\n    ''printed_unit_price_basis'',um[1],\n    ''normalized_unit_price'',case when um[1] ~* ''^100\\s*(g|ml)'' then printed_unit_price * 10 else printed_unit_price end,\n    ''coverage_note''';
  if strpos(v_def,v_old)=0 then
    raise exception 'Lidl parser unit-price metadata fragment not found';
  end if;
  v_def := replace(v_def,v_old,v_new);
  execute v_def;

  -- Lidl publisher: a verified package variant may reuse an alias only when quantity agrees.
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname='publish_lidl_verified_markdown_full'
  limit 1;

  v_old := 'where pa.normalized_alias=v_row.normalized_title and (pa.source_store_id=v_store_id or pa.source_store_id is null)';
  v_new := 'where pa.normalized_alias=v_row.normalized_title and (pa.source_store_id=v_store_id or pa.source_store_id is null) and coalesce(nullif(btrim(p.quantity_text),''''),nullif(btrim(pa.quantity_text),''''),'''')=coalesce(btrim(v_row.quantity_text),'''')';
  if strpos(v_def,v_old)=0 then
    raise exception 'Lidl publisher alias identity fragment not found';
  end if;
  v_def := replace(v_def,v_old,v_new);
  execute v_def;

  -- COOP publisher has the same alias-only identity path; make it quantity-aware too.
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname='publish_coop_verified_markdown_full'
  limit 1;

  v_old := 'where pa.normalized_alias=v_row.normalized_title and (pa.source_store_id=v_store_id or pa.source_store_id is null)';
  v_new := 'where pa.normalized_alias=v_row.normalized_title and (pa.source_store_id=v_store_id or pa.source_store_id is null) and coalesce(nullif(btrim(p.quantity_text),''''),nullif(btrim(pa.quantity_text),''''),'''')=coalesce(btrim(v_row.quantity_text),'''')';
  if strpos(v_def,v_old)=0 then
    raise exception 'COOP publisher alias identity fragment not found';
  end if;
  v_def := replace(v_def,v_old,v_new);
  execute v_def;
end
$migration$;

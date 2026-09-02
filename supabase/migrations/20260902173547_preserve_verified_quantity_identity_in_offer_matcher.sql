do $migration$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  -- Persist the parser's exact quantity on Lidl offers before the generic product matcher runs.
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname='publish_lidl_verified_markdown_full'
  limit 1;
  v_old := 'jsonb_build_object(''import_id'',v_import_id,''source_signature''';
  v_new := 'jsonb_build_object(''import_id'',v_import_id,''parsed_quantity'',v_row.quantity_text,''source_signature''';
  if strpos(v_def,v_old)=0 then raise exception 'Lidl offer metadata fragment not found'; end if;
  v_def := replace(v_def,v_old,v_new);
  execute v_def;

  -- Same contract for COOP verified PDF offers.
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname='publish_coop_verified_markdown_full'
  limit 1;
  v_old := 'jsonb_build_object(''import_id'',v_import_id,''source_signature''';
  v_new := 'jsonb_build_object(''import_id'',v_import_id,''parsed_quantity'',v_row.quantity_text,''source_signature''';
  if strpos(v_def,v_old)=0 then raise exception 'COOP offer metadata fragment not found'; end if;
  v_def := replace(v_def,v_old,v_new);
  execute v_def;

  -- The global offer matcher must retain a verified package identity when the publisher supplied one.
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='match_offer_to_product_master'
  limit 1;

  v_old := E'  offer_kl_nr := nullif(trim(coalesce(new.metadata ->> ''kaufland_kl_nr'', '''')), '''');';
  v_new := E'  if adapter in (''lidl-verified-pdf-text-v2'',''coop-verified-pdf-text-v1'') and new.product_id is not null then\n    parsed_quantity := public.product_quantity_key(new.metadata ->> ''parsed_quantity'');\n    select public.product_quantity_key(coalesce(p.quantity_text, p.name)) into intended_quantity\n    from public.products p where p.id = new.product_id and p.is_active=true;\n    if parsed_quantity is not null and intended_quantity = parsed_quantity then\n      new.catalog_match_status := case when previous_product_id = new.product_id then ''retained'' else ''matched'' end;\n      new.catalog_match_score := 1; new.catalog_checked_at := now(); return new;\n    end if;\n  end if;\n\n  offer_kl_nr := nullif(trim(coalesce(new.metadata ->> ''kaufland_kl_nr'', '''')), '''');';
  if strpos(v_def,v_old)=0 then raise exception 'Global offer matcher insertion point not found'; end if;
  v_def := replace(v_def,v_old,v_new);
  execute v_def;
end
$migration$;

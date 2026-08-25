do $migration$
declare
  v_oid oid;
  v_def text;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='reconcile_pro_doma_index_sync';
  if v_oid is null then raise exception 'reconcile_pro_doma_index_sync is missing'; end if;

  v_def := pg_get_functiondef(v_oid);
  if v_def not like '%v_fetch_event_url text;%' then
    v_def := replace(v_def,
      E'  v_url text;\n  v_req bigint;',
      E'  v_url text;\n  v_fetch_event_url text;\n  v_req bigint;');
  end if;

  if v_def not like '%v_fetch_event_url := regexp_replace%' then
    v_def := replace(v_def,
      E'    loop\n      v_req := net.http_get(\n        url := ''https://r.jina.ai/'' || v_url,',
      E'    loop\n      v_fetch_event_url := regexp_replace(v_url,''^https://www[.]pro-doma[.]cz/'',''https://assets.pro-doma.cz/'');\n      v_req := net.http_get(\n        url := ''https://r.jina.ai/'' || v_fetch_event_url,');
  end if;

  if v_def not like '%''fetch_url'',v_fetch_event_url%' then
    v_def := replace(v_def,
      E'          ''event_url'',v_url,\n          ''index_request_id'',j.request_id,',
      E'          ''event_url'',v_url,\n          ''fetch_url'',v_fetch_event_url,\n          ''index_request_id'',j.request_id,');
  end if;

  if v_def not like '%''detail_fetch_origin'',''assets.pro-doma.cz''%' then
    v_def := replace(v_def,
      E'metadata=metadata||jsonb_build_object(''expected_events'',v_count,''published'',false)',
      E'metadata=metadata||jsonb_build_object(''expected_events'',v_count,''published'',false,''detail_fetch_origin'',''assets.pro-doma.cz'')');
  end if;

  if v_def not like '%https://assets.pro-doma.cz/%' or v_def not like '%''fetch_url'',v_fetch_event_url%' then
    raise exception 'PRO-DOMA assets index patch did not apply';
  end if;
  execute v_def;
end
$migration$;

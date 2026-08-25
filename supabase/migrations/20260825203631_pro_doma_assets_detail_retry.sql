do $migration$
declare
  v_oid oid;
  v_def text;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='reconcile_pro_doma_detail_sync';
  if v_oid is null then raise exception 'reconcile_pro_doma_detail_sync is missing'; end if;

  v_def := pg_get_functiondef(v_oid);
  if v_def not like '%v_fetch_url text;%' then
    v_def := replace(v_def,
      E'  v_transient boolean;\nbegin',
      E'  v_transient boolean;\n  v_fetch_url text;\nbegin');
  end if;

  if v_def not like '%v_fetch_url := coalesce%' then
    v_def := replace(v_def,
      E'      v_retry_count := coalesce((d.metadata->>''retry_count'')::int,0);\n      select * into v_http',
      E'      v_retry_count := coalesce((d.metadata->>''retry_count'')::int,0);\n      v_fetch_url := coalesce(nullif(d.metadata->>''fetch_url'',''''),regexp_replace(d.metadata->>''event_url'',''^https://www[.]pro-doma[.]cz/'',''https://assets.pro-doma.cz/''));\n      select * into v_http');
  end if;

  v_def := replace(v_def,
    E'url := ''https://r.jina.ai/'' || (d.metadata->>''event_url'')',
    E'url := ''https://r.jina.ai/'' || v_fetch_url');

  if v_def not like '%https://assets.pro-doma.cz/%' or v_def like '%url := ''https://r.jina.ai/'' || (d.metadata->>''event_url'')%' then
    raise exception 'PRO-DOMA assets detail retry patch did not apply';
  end if;
  execute v_def;
end
$migration$;

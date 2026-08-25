do $migration$
declare
  v_name text;
  v_oid oid;
  v_def text;
  v_old text := E'headers := jsonb_build_object(''User-Agent'',''Slevao/1.0'',''Accept'',''text/plain,text/markdown''),';
  v_new text := E'headers := jsonb_build_object(''User-Agent'',''Slevao/1.0'',''Accept'',''text/plain,text/markdown'',''X-No-Cache'',''true'',''Cache-Control'',''no-cache''),';
begin
  foreach v_name in array array['reconcile_pro_doma_index_sync','reconcile_pro_doma_detail_sync'] loop
    select p.oid into v_oid
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=v_name;
    if v_oid is null then raise exception '% is missing',v_name; end if;
    v_def := pg_get_functiondef(v_oid);
    if v_def not like '%''X-No-Cache'', ''true''%' and v_def not like '%''X-No-Cache'',''true''%' then
      v_def := replace(v_def,v_old,v_new);
    end if;
    if v_def not like '%X-No-Cache%' or v_def not like '%Cache-Control%' then
      raise exception 'PRO-DOMA cache bypass patch did not apply to %',v_name;
    end if;
    execute v_def;
  end loop;
end
$migration$;

do $$
declare
  v_sql text;
begin
  select pg_get_functiondef('public.publish_albert_publitas_text_offers_v4_strong(text,jsonb)'::regprocedure) into v_sql;
  if position('if v_count < 80 then' in lower(v_sql)) = 0 then
    raise exception 'Expected Albert strong wrapper floor 80 was not found.';
  end if;
  v_sql := replace(v_sql,
    'if v_count < 80 then',
    'if v_count < 50 then');
  v_sql := replace(v_sql,
    'bezpečnostní minimum je 80.',
    'bezpečnostní minimum je 50.');
  execute v_sql;

  select pg_get_functiondef('public.publish_albert_publitas_text_offers_v4(text,jsonb)'::regprocedure) into v_sql;
  if position('if v_input_count < 80 then' in lower(v_sql)) = 0
     or position('if v_published<80 then' in lower(v_sql)) = 0 then
    raise exception 'Expected Albert v4 publisher floors 80 were not found.';
  end if;
  v_sql := replace(v_sql,
    'if v_input_count < 80 then',
    'if v_input_count < 50 then');
  v_sql := replace(v_sql,
    'bezpečnostní minimum je 80.',
    'bezpečnostní minimum je 50.');
  v_sql := replace(v_sql,
    'if v_published<80 then',
    'if v_published<50 then');
  execute v_sql;
end
$$;

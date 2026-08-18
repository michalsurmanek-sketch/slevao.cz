do $migration$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef('public.publish_albert_publitas_text_offers_v4(text,jsonb)'::regprocedure)
    into v_def;

  if v_def like '%slevao:albert-publitas-v4%' then
    return;
  end if;

  v_new := replace(
    v_def,
    E'begin\n  if coalesce(length(p_signature), 0) < 16',
    E'begin\n  perform pg_advisory_xact_lock(hashtextextended(''slevao:albert-publitas-v4'', 0));\n  if coalesce(length(p_signature), 0) < 16'
  );

  if v_new = v_def then
    raise exception 'Albert v4 publisher body changed; advisory lock insertion point was not found.';
  end if;

  execute v_new;
end
$migration$;

comment on function public.publish_albert_publitas_text_offers_v4(text,jsonb)
is 'Albert Publitas v4 publisher. Serialized by transaction advisory lock slevao:albert-publitas-v4 to prevent concurrent duplicate product creation.';

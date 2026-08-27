-- PRO-DOMA can receive a cached 267-byte Jina Reader placeholder for the
-- official assets index. Detail retries already bypass cache, but the initial
-- index, index retries, and initial detail fan-out did not. Harden only those
-- transport calls; parser and publication guards remain unchanged.

do $migration$
declare
  v_def text;
  v_marker text := '''Accept'',''text/plain,text/markdown''';
  v_expanded text := '''Accept'',''text/plain,text/markdown'',''X-No-Cache'',''true'',''Cache-Control'',''no-cache''';
  v_marker_count int;
  v_expanded_count int;
begin
  select pg_get_functiondef('public.trigger_pro_doma_verified_sync()'::regprocedure)
    into v_def;

  v_marker_count := (length(v_def) - length(replace(v_def, v_marker, ''))) / length(v_marker);
  v_expanded_count := (length(v_def) - length(replace(v_def, v_expanded, ''))) / length(v_expanded);

  if v_expanded_count = 1 then
    null;
  elsif v_expanded_count = 0 and v_marker_count = 1 then
    v_def := replace(v_def, v_marker, v_expanded);
    execute v_def;
  else
    raise exception 'Unexpected trigger_pro_doma_verified_sync header shape: marker %, hardened %',
      v_marker_count, v_expanded_count;
  end if;

  select pg_get_functiondef('public.reconcile_pro_doma_index_sync()'::regprocedure)
    into v_def;

  v_marker_count := (length(v_def) - length(replace(v_def, v_marker, ''))) / length(v_marker);
  v_expanded_count := (length(v_def) - length(replace(v_def, v_expanded, ''))) / length(v_expanded);

  if v_expanded_count = 3 then
    null;
  elsif v_expanded_count = 0 and v_marker_count = 3 then
    v_def := replace(v_def, v_marker, v_expanded);
    execute v_def;
  else
    raise exception 'Unexpected reconcile_pro_doma_index_sync header shape: marker %, hardened %',
      v_marker_count, v_expanded_count;
  end if;
end
$migration$;

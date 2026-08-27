-- Möbelix occasionally receives a cached, truncated Jina Reader response for one
-- SALE category (HTTP 200 with only a few hundred bytes). Keep the parser and
-- publication guards unchanged; only harden every Jina request with explicit
-- cache-bypass headers, matching the already-stable COOP reader strategy.
--
-- Patch the live function definitions defensively so this migration stays small
-- and cannot silently alter unrelated parser/publication logic.

do $migration$
declare
  v_def text;
  v_marker text := '''X-With-Links-Summary'',''true''';
  v_expanded text := '''X-With-Links-Summary'',''true'',''X-No-Cache'',''true'',''Cache-Control'',''no-cache''';
  v_marker_count int;
  v_expanded_count int;
begin
  select pg_get_functiondef('public.trigger_moebelix_verified_sync()'::regprocedure)
    into v_def;

  v_marker_count := (length(v_def) - length(replace(v_def, v_marker, ''))) / length(v_marker);
  v_expanded_count := (length(v_def) - length(replace(v_def, v_expanded, ''))) / length(v_expanded);

  if v_expanded_count = 1 then
    null;
  elsif v_expanded_count = 0 and v_marker_count = 1 then
    v_def := replace(v_def, v_marker, v_expanded);
    execute v_def;
  else
    raise exception 'Unexpected trigger_moebelix_verified_sync header shape: marker %, hardened %',
      v_marker_count, v_expanded_count;
  end if;

  select pg_get_functiondef('public.reconcile_moebelix_verified_sync()'::regprocedure)
    into v_def;

  v_marker_count := (length(v_def) - length(replace(v_def, v_marker, ''))) / length(v_marker);
  v_expanded_count := (length(v_def) - length(replace(v_def, v_expanded, ''))) / length(v_expanded);

  if v_expanded_count = 3 then
    null;
  elsif v_expanded_count = 0 and v_marker_count = 3 then
    v_def := replace(v_def, v_marker, v_expanded);
    execute v_def;
  else
    raise exception 'Unexpected reconcile_moebelix_verified_sync header shape: marker %, hardened %',
      v_marker_count, v_expanded_count;
  end if;
end
$migration$;

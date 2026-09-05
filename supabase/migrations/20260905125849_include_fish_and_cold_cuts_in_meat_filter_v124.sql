do $migration$
declare
  fn_oid oid;
  fn_def text;
  anchor text := E'  case p_tag\n    when ''beer_lager''';
  replacement text := E'  case p_tag\n    when ''meat'' then return tags && array[''meat'',''fish'',''cold_cuts'']::text[];\n    when ''beer_lager''';
begin
  select p.oid
    into strict fn_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'public_semantic_offer_matches_normalized'
    and pg_get_function_identity_arguments(p.oid) = 'p_tag text, p_semantic_tags text[], p_normalized_title text, p_normalized_all_text text';

  fn_def := pg_get_functiondef(fn_oid);

  if position('when ''meat'' then return tags && array[''meat'',''fish'',''cold_cuts'']::text[]' in fn_def) > 0 then
    return;
  end if;

  if position(anchor in fn_def) = 0 then
    raise exception 'public_semantic_offer_matches_normalized patch anchor not found';
  end if;

  fn_def := replace(fn_def, anchor, replacement);
  execute fn_def;
end
$migration$;

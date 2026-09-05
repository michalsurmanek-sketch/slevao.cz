do $migration$
declare
  fn_oid oid;
  fn_def text;
  old_fragment text := $old$when 'milk' then return tags && array['milk','plant_drink']::text[];$old$;
  new_fragment text := $new$when 'milk' then return tags && array['milk','plant_drink']::text[]
      and n !~ '(^| )(dezert[a-z0-9]*|detske mleko|mleko pro kock[a-z0-9]*|smetan[a-z0-9]*)( |$)';$new$;
begin
  select p.oid into strict fn_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='public_semantic_offer_matches_normalized'
    and pg_get_function_identity_arguments(p.oid)='p_tag text, p_semantic_tags text[], p_normalized_title text, p_normalized_all_text text';

  fn_def := pg_get_functiondef(fn_oid);

  if position(new_fragment in fn_def) > 0 then
    return;
  end if;
  if position(old_fragment in fn_def) = 0 then
    raise exception 'milk matcher anchor not found';
  end if;

  fn_def := replace(fn_def, old_fragment, new_fragment);
  execute fn_def;
end
$migration$;

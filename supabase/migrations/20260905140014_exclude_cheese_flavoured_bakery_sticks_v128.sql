do $migration$
declare
  fn_oid oid;
  fn_def text;
  anchor text := $a$when 'milk' then return tags && array['milk','plant_drink']::text[]
      and n !~ '(^| )(dezert[a-z0-9]*|detske mleko|mleko pro kock[a-z0-9]*|smetan[a-z0-9]*)( |$)';$a$;
  replacement text := $r$when 'milk' then return tags && array['milk','plant_drink']::text[]
      and n !~ '(^| )(dezert[a-z0-9]*|detske mleko|mleko pro kock[a-z0-9]*|smetan[a-z0-9]*)( |$)';
    when 'cheese' then return has_cheese and n !~ '(^| )tycink[a-z0-9]* se syrem( |$)';$r$;
begin
  select p.oid into strict fn_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='public_semantic_offer_matches_normalized'
    and pg_get_function_identity_arguments(p.oid)='p_tag text, p_semantic_tags text[], p_normalized_title text, p_normalized_all_text text';
  fn_def := pg_get_functiondef(fn_oid);
  if position($s$when 'cheese' then return has_cheese and n !~ '(^| )tycink[a-z0-9]* se syrem( |$)';$s$ in fn_def)>0 then return; end if;
  if position(anchor in fn_def)=0 then raise exception 'cheese matcher anchor not found'; end if;
  fn_def := replace(fn_def,anchor,replacement);
  execute fn_def;
end
$migration$;

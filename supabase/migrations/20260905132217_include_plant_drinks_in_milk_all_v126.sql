do $migration$
declare
  fn_oid oid;
  fn_def text;
begin
  select p.oid into strict fn_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='public_semantic_tag_filter_group'
    and pg_get_function_identity_arguments(p.oid)='p_tag text';
  fn_def := pg_get_functiondef(fn_oid);
  if position($s$when p_tag = 'milk' then null$s$ in fn_def)=0 then
    if position($s$select case$s$ in fn_def)=0 then raise exception 'semantic group case anchor not found'; end if;
    fn_def := replace(fn_def, $s$select case$s$, $s$select case
  when p_tag = 'milk' then null$s$);
  end if;
  execute fn_def;

  select p.oid into strict fn_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='public_semantic_offer_matches_normalized'
    and pg_get_function_identity_arguments(p.oid)='p_tag text, p_semantic_tags text[], p_normalized_title text, p_normalized_all_text text';
  fn_def := pg_get_functiondef(fn_oid);
  if position($s$when 'milk' then return tags && array['milk','plant_drink']::text[];$s$ in fn_def)=0 then
    if position($s$when 'meat' then return tags && array['meat','fish','cold_cuts']::text[];$s$ in fn_def)=0 then raise exception 'semantic match anchor not found'; end if;
    fn_def := replace(fn_def,
      $s$when 'meat' then return tags && array['meat','fish','cold_cuts']::text[];$s$,
      $s$when 'meat' then return tags && array['meat','fish','cold_cuts']::text[];
    when 'milk' then return tags && array['milk','plant_drink']::text[];$s$);
  end if;
  execute fn_def;
end
$migration$;

do $migration$
declare
  fn_oid oid;
  fn_def text;
begin
  select p.oid into strict fn_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='public_semantic_query_tag'
    and pg_get_function_identity_arguments(p.oid)='p_query text';
  fn_def := pg_get_functiondef(fn_oid);
  if position($s$when 'ovoce' then 'fruit_all'$s$ in fn_def)=0 then
    if position($s$when 'ovoce' then 'fruit_fresh'$s$ in fn_def)=0 then raise exception 'fruit query mapping anchor not found'; end if;
    fn_def := replace(fn_def, $s$when 'ovoce' then 'fruit_fresh'$s$, $s$when 'ovoce' then 'fruit_all'
  when 'cerstve ovoce' then 'fruit_fresh'$s$);
  end if;
  if position($s$when 'zelenina' then 'veg_all'$s$ in fn_def)=0 then
    if position($s$when 'zelenina' then 'veg_fresh'$s$ in fn_def)=0 then raise exception 'vegetable query mapping anchor not found'; end if;
    fn_def := replace(fn_def, $s$when 'zelenina' then 'veg_fresh'$s$, $s$when 'zelenina' then 'veg_all'
  when 'cerstva zelenina' then 'veg_fresh'$s$);
  end if;
  execute fn_def;

  select p.oid into strict fn_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='public_semantic_tag_filter_group'
    and pg_get_function_identity_arguments(p.oid)='p_tag text';
  fn_def := pg_get_functiondef(fn_oid);
  if position($s$'fruit_all','fruit_fresh'$s$ in fn_def)=0 then
    if position($s$'fruit_fresh','apples'$s$ in fn_def)=0 then raise exception 'fruit group anchor not found'; end if;
    fn_def := replace(fn_def, $s$'fruit_fresh','apples'$s$, $s$'fruit_all','fruit_fresh','apples'$s$);
  end if;
  if position($s$'veg_all','veg_fresh'$s$ in fn_def)=0 then
    if position($s$'veg_fresh','potatoes'$s$ in fn_def)=0 then raise exception 'vegetable group anchor not found'; end if;
    fn_def := replace(fn_def, $s$'veg_fresh','potatoes'$s$, $s$'veg_all','veg_fresh','potatoes'$s$);
  end if;
  execute fn_def;

  select p.oid into strict fn_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='public_semantic_offer_matches_normalized'
    and pg_get_function_identity_arguments(p.oid)='p_tag text, p_semantic_tags text[], p_normalized_title text, p_normalized_all_text text';
  fn_def := pg_get_functiondef(fn_oid);
  if position($s$when 'fruit_all' then return tags && array['fruit_fresh','fruit_frozen','fruit_dried']::text[];$s$ in fn_def)=0 then
    if position($s$when 'meat' then return tags && array['meat','fish','cold_cuts']::text[];$s$ in fn_def)=0 then raise exception 'semantic match anchor not found'; end if;
    fn_def := replace(fn_def,
      $s$when 'meat' then return tags && array['meat','fish','cold_cuts']::text[];$s$,
      $s$when 'meat' then return tags && array['meat','fish','cold_cuts']::text[];
    when 'fruit_all' then return tags && array['fruit_fresh','fruit_frozen','fruit_dried']::text[];
    when 'veg_all' then return tags && array['veg_fresh','veg_frozen','veg_preserved','veg_products']::text[];$s$);
  end if;
  execute fn_def;
end
$migration$;

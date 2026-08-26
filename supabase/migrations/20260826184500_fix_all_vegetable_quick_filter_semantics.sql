-- SLEVAO.cz: strict semantic tags for every vegetable quick filter.
-- Known quick filters must never fall back to fuzzy text matching.

do $migration$
declare
  d text;
begin
  d := pg_get_functiondef('public.public_offer_semantic_tags(text)'::regprocedure);

  if position('fresh_leaf_salad boolean;' in d) = 0
     or position('  veg := veg_any and not veg_processed;' in d) = 0
     or position('  if veg then tags:=array_append(tags,''veg_fresh''); end if;' in d) = 0 then
    raise exception 'public_offer_semantic_tags definition does not match expected base';
  end if;

  d := replace(
    d,
    '  fresh_leaf_salad boolean;',
    E'  fresh_leaf_salad boolean;\n  peppers boolean;\n  onions boolean;\n  leafy_veg boolean;\n  veg_products boolean;'
  );

  d := replace(
    d,
    '  veg := veg_any and not veg_processed;',
    E'  veg := veg_any and not veg_processed;\n\n  -- Přesné podtypy rychlého filtru zeleniny. Vycházejí jen ze skutečné\n  -- čerstvé zeleniny, takže výraz v názvu jiného výrobku nemůže stačit.\n  peppers := veg and s ~ ''(^| )paprik[a-z0-9]*( |$)'';\n  onions := veg and s ~ ''(^| )cibul[a-z0-9]*( |$)'';\n  leafy_veg := veg and (\n    fresh_leaf_salad\n    or s ~ ''(^| )(spenat[a-z0-9]*|kapust[a-z0-9]*|zeli)( |$)''\n  );\n\n  -- Zeleninové výrobky jsou samostatná větev; nestačí pouhé slovo zelenina.\n  -- Koření a ochucovadla se sem nesmí dostat.\n  veg_products :=\n    s ~ ''(^| )zelenin[a-z0-9]*( |$)''\n    and s ~ ''(^| )(smes[a-z0-9]*|pomazank[a-z0-9]*|pyre|protlak[a-z0-9]*|polevk[a-z0-9]*|omack[a-z0-9]*|karbanat[a-z0-9]*|burger[a-z0-9]*)( |$)''\n    and s !~ ''(^| )(vitana|knorr|maggi|koreni|korenici|bujon|ochucovad[a-z0-9]*|prichut[a-z0-9]*)( |$)'';'
  );

  d := replace(
    d,
    '  if veg then tags:=array_append(tags,''veg_fresh''); end if;',
    E'  if veg then tags:=array_append(tags,''veg_fresh''); end if;\n  if peppers then tags:=array_append(tags,''peppers''); end if;\n  if onions then tags:=array_append(tags,''onions''); end if;\n  if leafy_veg then tags:=array_append(tags,''leafy_veg''); end if;\n  if veg_products then tags:=array_append(tags,''veg_products''); end if;'
  );

  execute d;
end;
$migration$;

create or replace function public.public_semantic_query_tag(p_query text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
select case public.normalize_text(coalesce(p_query,''))
  when 'pivo' then 'beer'
  when 'mleko' then 'milk'
  when 'pecivo' then 'bread'
  when 'rohlik' then 'rolls'
  when 'rohliky' then 'rolls'
  when 'chleb' then 'loaf'
  when 'bageta' then 'baguette'
  when 'bagety' then 'baguette'
  when 'vejce' then 'eggs'
  when 'maslo' then 'butter'
  when 'syr' then 'cheese'
  when 'eidam' then 'eidam'
  when 'gouda' then 'gouda'
  when 'maso' then 'meat'
  when 'kure' then 'chicken'
  when 'kureci' then 'chicken'
  when 'krkovice' then 'pork_neck'
  when 'krkovicka' then 'pork_neck'
  when 'veprove' then 'pork'
  when 'hovezi' then 'beef'
  when 'ovoce' then 'fruit_fresh'
  when 'jablko' then 'apples'
  when 'jablka' then 'apples'
  when 'banan' then 'bananas'
  when 'banany' then 'bananas'
  when 'mrazene ovoce' then 'fruit_frozen'
  when 'susene ovoce' then 'fruit_dried'
  when 'ovocne napoje' then 'fruit_drink'
  when 'zelenina' then 'veg_fresh'
  when 'brambora' then 'potatoes'
  when 'brambory' then 'potatoes'
  when 'rajce' then 'tomatoes'
  when 'rajcata' then 'tomatoes'
  when 'paprika' then 'peppers'
  when 'papriky' then 'peppers'
  when 'cibule' then 'onions'
  when 'korennova zelenina' then 'root_veg'
  when 'korenova zelenina' then 'root_veg'
  when 'listova zelenina' then 'leafy_veg'
  when 'mrazena zelenina' then 'veg_frozen'
  when 'sterilovana zelenina' then 'veg_preserved'
  when 'zeleninove vyrobky' then 'veg_products'
  else null
end;
$function$;

create or replace function public.public_semantic_tag_filter_group(p_tag text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
select case
  when p_tag in ('beer','fruit_drink') then 'drinks'
  when p_tag in (
    'milk','bread','rolls','loaf','baguette','eggs','butter','cheese','eidam','gouda',
    'meat','chicken','pork_neck','pork','beef',
    'fruit_fresh','apples','bananas','fruit_frozen','fruit_dried',
    'veg_fresh','potatoes','tomatoes','peppers','onions','root_veg','leafy_veg',
    'veg_frozen','veg_preserved','veg_products'
  ) then 'food'
  else null
end;
$function$;

refresh materialized view private.public_offer_search_cache;

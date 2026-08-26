-- SLEVAO.cz: exact semantic tags for bakery quick filters.
-- Known bakery filters must not fall back to fuzzy text matching.

set local statement_timeout = '60s';

do $migration$
declare
  d text;
begin
  d := pg_get_functiondef('public.public_offer_semantic_tags(text)'::regprocedure);

  if position('  bread boolean;' in d) = 0
     or position('  -- Mléko:' in d) = 0
     or position('  if bread then tags:=array_append(tags,''bread''); end if;' in d) = 0 then
    raise exception 'public_offer_semantic_tags definition does not match expected bakery base';
  end if;

  d := replace(
    d,
    '  bread boolean;',
    E'  bread boolean;\n  buns boolean;\n  sweet_bakery boolean;\n  bread_fresh boolean;\n  bread_packaged boolean;\n  bread_gluten_free boolean;'
  );

  d := replace(d, 'kaiserka|koblih', 'kaiserka|bulk[a-z0-9]*|koblih');

  d := replace(
    d,
    'zavinace|forma|knedl[a-z0-9]*',
    'zavinace|forma|formy|hrack[a-z0-9]*|pro psy|pro psa|piskac[a-z0-9]*|latexov[a-z0-9]*|huhubamboo|knedl[a-z0-9]*'
  );

  d := replace(
    d,
    '  -- Mléko:',
    E'  -- Přesné podtypy rychlého filtru pečiva.\n  buns := bread and s ~ ''(^| )(housk[a-z0-9]*|kaiserka|bulk[a-z0-9]*)( |$)'';\n\n  sweet_bakery := bread and (\n    s ~ ''(^| )(donut[a-z0-9]*|muffin[a-z0-9]*|koblih[a-z0-9]*|kolac[a-z0-9]*|buchta|mazanec[a-z0-9]*|loupak[a-z0-9]*|zavin[a-z0-9]*|strudl[a-z0-9]*)( |$)''\n    or s ~ ''(^| )(sladk[a-z0-9]* peciv[a-z0-9]*|cajov[a-z0-9]* peciv[a-z0-9]*|koblihov[a-z0-9]* bananek)( |$)''\n    or (\n      s ~ ''(^| )croissant[a-z0-9]*( |$)''\n      and s !~ ''(^| )(sunk[a-z0-9]*|syr[a-z0-9]*|slanina|parek|parky|klobas[a-z0-9]*|slan[a-z0-9]*)( |$)''\n    )\n  );\n\n  -- Formu pečiva označujeme jen při explicitním důkazu.\n  bread_fresh := bread and s ~ ''(^| )cerstv[a-z0-9]*( |$)'';\n  bread_packaged := bread and s ~ ''(^| )(balen[a-z0-9]*|baleni|multipack)( |$)'';\n  bread_gluten_free := bread and s ~ ''(^| )(bezlepk[a-z0-9]*|gluten free)( |$)'';\n\n  -- Mléko:'
  );

  d := replace(
    d,
    '  if bread then tags:=array_append(tags,''bread''); end if;',
    E'  if bread then tags:=array_append(tags,''bread''); end if;\n  if buns then tags:=array_append(tags,''buns''); end if;\n  if sweet_bakery then tags:=array_append(tags,''sweet_bakery''); end if;\n  if bread_fresh then tags:=array_append(tags,''bread_fresh''); end if;\n  if bread_packaged then tags:=array_append(tags,''bread_packaged''); end if;\n  if bread_gluten_free then tags:=array_append(tags,''bread_gluten_free''); end if;'
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
  when 'houska' then 'buns'
  when 'housky' then 'buns'
  when 'bageta' then 'baguette'
  when 'bagety' then 'baguette'
  when 'sladke pecivo' then 'sweet_bakery'
  when 'cerstve pecivo' then 'bread_fresh'
  when 'balene pecivo' then 'bread_packaged'
  when 'bezlepkove pecivo' then 'bread_gluten_free'
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
    'milk','bread','rolls','loaf','buns','baguette','sweet_bakery','bread_fresh','bread_packaged','bread_gluten_free',
    'eggs','butter','cheese','eidam','gouda',
    'meat','chicken','pork_neck','pork','beef',
    'fruit_fresh','apples','bananas','fruit_frozen','fruit_dried',
    'veg_fresh','potatoes','tomatoes','peppers','onions','root_veg','leafy_veg',
    'veg_frozen','veg_preserved','veg_products'
  ) then 'food'
  else null
end;
$function$;

refresh materialized view private.public_offer_search_cache;

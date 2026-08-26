set local statement_timeout = '60s';

do $migration$
declare
  d text;
begin
  d := pg_get_functiondef('public.public_semantic_offer_matches(text,text[],text,text)'::regprocedure);

  d := replace(d,
    $$when 'beer_bottle' then return has_beer and all_text ~ '(^| )(lahv[a-z0-9]*|sklo)( |$)';$$,
    $$when 'beer_bottle' then return has_beer and all_text ~ '(^| )(lahev|lahv[a-z0-9]*|sklo)( |$)';$$
  );

  d := replace(d,
    $$when 'milk_fullfat' then return has_milk and n ~ '(^| )plnotuc[a-z0-9]*( |$)';$$,
    $$when 'milk_fullfat' then return has_milk and (n ~ '(^| )plnotuc[a-z0-9]*( |$)' or n ~ '(^| )3 5 %( |$)' or n ~ '(^| )3 6 %( |$)');$$
  );

  d := replace(d,
    $$when 'milk_semiskim' then return has_milk and n ~ '(^| )polotuc[a-z0-9]*( |$)';$$,
    $$when 'milk_semiskim' then return has_milk and (n ~ '(^| )polotuc[a-z0-9]*( |$)' or n ~ '(^| )1 5 %( |$)');$$
  );

  d := replace(d,
    $$when 'cheese_hermelin' then return has_cheese and n ~ '(^| )hermelin[a-z0-9]*( |$)';$$,
    $$when 'cheese_hermelin' then return has_cheese and n ~ '(^| )hermelin[a-z0-9]*( |$)' and n !~ '(^| )pomazank[a-z0-9]*( |$)';$$
  );

  d := replace(d,
    $$and n !~ '(^| )(prst[a-z0-9]*|salat[a-z0-9]*|pomazank[a-z0-9]*|koreni|konzerv[a-z0-9]*|sushi|pamlsk[a-z0-9]*|hrack[a-z0-9]*|mrizk[a-z0-9]*)( |$)';$$,
    $$and n !~ '(^| )(prst[a-z0-9]*|salat[a-z0-9]*|pomazank[a-z0-9]*|koreni|konzerv[a-z0-9]*|sushi|pamlsk[a-z0-9]*|hrack[a-z0-9]*|mrizk[a-z0-9]*|surimi|matjes[a-z0-9]*|olej[a-z0-9]*|rezy|kousky)( |$)';$$
  );

  d := replace(d,
    $$and n !~ '(^| )(syr[a-z0-9]*|eidam[a-z0-9]*|pizza|vegetari[a-z0-9]*|vegansk[a-z0-9]*|rostlinn[a-z0-9]*)( |$)';$$,
    $$and not (tags @> array['bread']::text[]) and n !~ '(^| )(syr[a-z0-9]*|eidam[a-z0-9]*|pizza|vegetari[a-z0-9]*|vegansk[a-z0-9]*|rostlinn[a-z0-9]*|pomazank[a-z0-9]*|pena|salat[a-z0-9]*|sendvic[a-z0-9]*)( |$)';$$
  );

  execute d;
end;
$migration$;

create or replace function public.public_semantic_tag_filter_group(p_tag text)
returns text
language sql
immutable
set search_path = public
as $function$
select case
  when p_tag in ('beer','beer_lager','beer_draught','beer_nonalc','beer_radler','beer_can','beer_bottle','beer_multipack','fruit_drink') then 'drinks'
  when p_tag in (
    'milk','milk_fullfat','milk_semiskim','milk_lactosefree','milk_fresh','milk_uht','milk_condensed',
    'bread','rolls','loaf','buns','baguette','sweet_bakery','bread_fresh','bread_packaged','bread_gluten_free',
    'eggs','eggs_chicken','eggs_quail','eggs_m','eggs_l','eggs_free_range','eggs_barn','eggs_bio',
    'butter','butter_classic','butter_ghee','butter_salted','butter_flavoured','butter_block','butter_tub',
    'cheese','eidam','gouda','cheese_hermelin','cheese_mozzarella','cheese_processed','cheese_hard','cheese_soft','cheese_sliced','cheese_grated',
    'meat','chicken','pork_neck','pork','beef','turkey','minced_meat','fish','meat_frozen','cold_cuts','marinated_meat',
    'fruit_fresh','apples','bananas','fruit_citrus','fruit_berries','fruit_exotic','fruit_frozen','fruit_dried',
    'veg_fresh','potatoes','tomatoes','peppers','onions','root_veg','leafy_veg','veg_frozen','veg_preserved','veg_products'
  ) then 'food'
  when p_tag = 'plant_drink' then null
  else null
end;
$function$;
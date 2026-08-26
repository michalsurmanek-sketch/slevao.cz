set local statement_timeout = '60s';

create or replace function public.public_semantic_offer_matches(
  p_tag text,
  p_semantic_tags text[],
  p_title text,
  p_quantity_text text default null
)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = public, pg_temp
as $function$
declare
  n text := public.normalize_text(coalesce(p_title,''));
  q text := public.normalize_text(coalesce(p_quantity_text,''));
  all_text text := public.normalize_text(concat_ws(' ',p_title,p_quantity_text));
  tags text[] := coalesce(p_semantic_tags,'{}'::text[]);
  has_beer boolean := tags @> array['beer']::text[];
  has_milk boolean := tags @> array['milk']::text[];
  has_eggs boolean := tags @> array['eggs']::text[];
  has_butter boolean := tags @> array['butter']::text[];
  has_cheese boolean := tags @> array['cheese']::text[];
  has_meat boolean := tags @> array['meat']::text[];
  has_fruit boolean := tags @> array['fruit_fresh']::text[];
begin
  if p_tag is null then return false; end if;

  case p_tag
    when 'beer_lager' then return has_beer and n ~ '(^| )lezak[a-z0-9]*( |$)';
    when 'beer_draught' then return has_beer and n ~ '(^| )vycepni[a-z0-9]*( |$)';
    when 'beer_nonalc' then return has_beer and n ~ '(^| )(nealko|nealkohol[a-z0-9]*)( |$)';
    when 'beer_radler' then return has_beer and n ~ '(^| )radler[a-z0-9]*( |$)';
    when 'beer_can' then return has_beer and all_text ~ '(^| )plech[a-z0-9]*( |$)';
    when 'beer_bottle' then return has_beer and all_text ~ '(^| )(lahv[a-z0-9]*|sklo)( |$)';
    when 'beer_multipack' then return has_beer and (all_text ~ '(^| )multipack( |$)' or all_text ~ '[2-9][0-9]*x[0-9]');

    when 'milk_fullfat' then return has_milk and n ~ '(^| )plnotuc[a-z0-9]*( |$)';
    when 'milk_semiskim' then return has_milk and n ~ '(^| )polotuc[a-z0-9]*( |$)';
    when 'milk_lactosefree' then return has_milk and n ~ '(^| )bezlaktoz[a-z0-9]*( |$)';
    when 'plant_drink' then return n ~ '(^| )(ovesn[a-z0-9]*|ryzov[a-z0-9]*|mandlov[a-z0-9]*|sojov[a-z0-9]*|kokosov[a-z0-9]*|liskooriskov[a-z0-9]*|kesu[a-z0-9]*) napoj[a-z0-9]*( |$)';
    when 'milk_fresh' then return has_milk and n ~ '(^| )(cerstv[a-z0-9]*|farmarsk[a-z0-9]*)( |$)' and n !~ '(^| )(trvanliv[a-z0-9]*|tvanliv[a-z0-9]*)( |$)';
    when 'milk_uht' then return has_milk and n ~ '(^| )(trvanliv[a-z0-9]*|tvanliv[a-z0-9]*)( |$)';
    when 'milk_condensed' then return has_milk and n ~ '(^| )(kondenz[a-z0-9]*|salko)( |$)';

    when 'eggs_chicken' then return has_eggs and n !~ '(^| )krepel[a-z0-9]*( |$)';
    when 'eggs_quail' then return has_eggs and n ~ '(^| )krepel[a-z0-9]*( |$)';
    when 'eggs_m' then return has_eggs and n ~ '(^| )m( |$)';
    when 'eggs_l' then return has_eggs and n ~ '(^| )l( |$)';
    when 'eggs_free_range' then return has_eggs and n ~ '(^| )(voln[a-z0-9]* vybeh[a-z0-9]*|z volneho vybehu)( |$)';
    when 'eggs_barn' then return has_eggs and n ~ '(^| )podestyl[a-z0-9]*( |$)';
    when 'eggs_bio' then return has_eggs and n ~ '(^| )bio( |$)';

    when 'butter_classic' then return has_butter and n !~ '(^| )(ghee|ghi|prepust[a-z0-9]*|solen[a-z0-9]*|ochuc[a-z0-9]*|bylink[a-z0-9]*|cesnek[a-z0-9]*)( |$)';
    when 'butter_ghee' then return has_butter and n ~ '(^| )(ghee|ghi|prepust[a-z0-9]*)( |$)';
    when 'butter_salted' then return has_butter and n ~ '(^| )solen[a-z0-9]*( |$)';
    when 'butter_flavoured' then return has_butter and n ~ '(^| )(ochuc[a-z0-9]*|bylink[a-z0-9]*|cesnek[a-z0-9]*)( |$)';
    when 'butter_block' then return has_butter and n !~ '(^| )(ghee|ghi|prepust[a-z0-9]*)( |$)' and all_text !~ '(^| )(kelimek[a-z0-9]*|vana|doza|sklenic[a-z0-9]*)( |$)';
    when 'butter_tub' then return has_butter and all_text ~ '(^| )(kelimek[a-z0-9]*|vana|doza)( |$)';

    when 'cheese_hermelin' then return has_cheese and n ~ '(^| )hermelin[a-z0-9]*( |$)';
    when 'cheese_mozzarella' then return has_cheese and n ~ '(^| )mozzarell[a-z0-9]*( |$)';
    when 'cheese_processed' then return has_cheese and n ~ '(^| )taven[a-z0-9]*( |$)';
    when 'cheese_hard' then return has_cheese and n ~ '(^| )(tvrd[a-z0-9]*|polotvrd[a-z0-9]*|eidam[a-z0-9]*|gouda|cheddar[a-z0-9]*|emmental[a-z0-9]*|maasdam[a-z0-9]*|parmezan[a-z0-9]*|grana)( |$)';
    when 'cheese_soft' then return has_cheese and n ~ '(^| )(mekk[a-z0-9]*|cerstv[a-z0-9]*|kremov[a-z0-9]*|termiz[a-z0-9]*|camembert[a-z0-9]*|hermelin[a-z0-9]*|mozzarell[a-z0-9]*|niva|rondel[a-z0-9]*|gervais|lucina)( |$)';
    when 'cheese_sliced' then return has_cheese and n ~ '(^| )platk[a-z0-9]*( |$)';
    when 'cheese_grated' then return has_cheese and n ~ '(^| )strouhan[a-z0-9]*( |$)';

    when 'turkey' then return has_meat and n ~ '(^| )krut[a-z0-9]*( |$)';
    when 'minced_meat' then return has_meat and n ~ '(^| )(mlet[a-z0-9]*|melnen[a-z0-9]*)( |$)';
    when 'fish' then return n ~ '(^| )(pstruh[a-z0-9]*|losos[a-z0-9]*|tresk[a-z0-9]*|tunak[a-z0-9]*|kapr[a-z0-9]*|makrel[a-z0-9]*|pangasi[a-z0-9]*|sled[a-z0-9]*|sardink[a-z0-9]*|prazm[a-z0-9]*|candat[a-z0-9]*|sumec[a-z0-9]*)( |$)'
      and n !~ '(^| )(prst[a-z0-9]*|salat[a-z0-9]*|pomazank[a-z0-9]*|koreni|konzerv[a-z0-9]*|sushi|pamlsk[a-z0-9]*|hrack[a-z0-9]*|mrizk[a-z0-9]*)( |$)';
    when 'meat_frozen' then return has_meat and n ~ '(^| )mrazen[a-z0-9]*( |$)';
    when 'cold_cuts' then return n ~ '(^| )(sunk[a-z0-9]*|salam[a-z0-9]*|klobas[a-z0-9]*|parek|parky|slanina|tlacenk[a-z0-9]*|spekack[a-z0-9]*|sulc|debrecinsk[a-z0-9]*|buckov[a-z0-9]* rolada)( |$)'
      and n !~ '(^| )(syr[a-z0-9]*|eidam[a-z0-9]*|pizza|vegetari[a-z0-9]*|vegansk[a-z0-9]*|rostlinn[a-z0-9]*)( |$)';
    when 'marinated_meat' then return has_meat and n ~ '(^| )(marinad[a-z0-9]*|bbq|barbecue)( |$)';

    when 'fruit_citrus' then return has_fruit and n ~ '(^| )(citron[a-z0-9]*|limet[a-z0-9]*|pomeranc[a-z0-9]*|mandarink[a-z0-9]*|grep[a-z0-9]*)( |$)';
    when 'fruit_berries' then return has_fruit and n ~ '(^| )(jahod[a-z0-9]*|malin[a-z0-9]*|boruv[a-z0-9]*|ostruzin[a-z0-9]*|rybiz[a-z0-9]*)( |$)';
    when 'fruit_exotic' then return has_fruit and n ~ '(^| )(mango|ananas[a-z0-9]*|avokad[a-z0-9]*|kiwi|papaj[a-z0-9]*|marakuj[a-z0-9]*|granatov[a-z0-9]*)( |$)';

    else return tags @> array[p_tag]::text[];
  end case;
end;
$function$;

create or replace function public.public_semantic_query_tag(p_query text)
returns text
language sql
immutable
set search_path = public
as $function$
select case public.normalize_text(coalesce(p_query,''))
  when 'pivo' then 'beer'
  when 'lezak' then 'beer_lager'
  when 'vycepni pivo' then 'beer_draught'
  when 'nealkoholicke pivo' then 'beer_nonalc'
  when 'radler' then 'beer_radler'
  when 'pivo plech' then 'beer_can'
  when 'pivo lahev' then 'beer_bottle'
  when 'multipack pivo' then 'beer_multipack'
  when 'mleko' then 'milk'
  when 'plnotucne mleko' then 'milk_fullfat'
  when 'polotucne mleko' then 'milk_semiskim'
  when 'bezlaktozove mleko' then 'milk_lactosefree'
  when 'rostlinny napoj' then 'plant_drink'
  when 'cerstve mleko' then 'milk_fresh'
  when 'trvanlive mleko' then 'milk_uht'
  when 'kondenzovane mleko' then 'milk_condensed'
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
  when 'slepici vejce' then 'eggs_chicken'
  when 'krepelci vejce' then 'eggs_quail'
  when 'vejce m' then 'eggs_m'
  when 'vejce l' then 'eggs_l'
  when 'vejce volny vybeh' then 'eggs_free_range'
  when 'vejce podestylka' then 'eggs_barn'
  when 'bio vejce' then 'eggs_bio'
  when 'maslo' then 'butter'
  when 'klasicke maslo' then 'butter_classic'
  when 'prepustene maslo' then 'butter_ghee'
  when 'solene maslo' then 'butter_salted'
  when 'ochucene maslo' then 'butter_flavoured'
  when 'maslo kostka' then 'butter_block'
  when 'maslo kelimek' then 'butter_tub'
  when 'syr' then 'cheese'
  when 'eidam' then 'eidam'
  when 'gouda' then 'gouda'
  when 'hermelin' then 'cheese_hermelin'
  when 'mozzarella' then 'cheese_mozzarella'
  when 'taveny syr' then 'cheese_processed'
  when 'tvrdy syr' then 'cheese_hard'
  when 'mekky syr' then 'cheese_soft'
  when 'platkovy syr' then 'cheese_sliced'
  when 'strouhany syr' then 'cheese_grated'
  when 'maso' then 'meat'
  when 'kure' then 'chicken'
  when 'kureci' then 'chicken'
  when 'krkovice' then 'pork_neck'
  when 'krkovicka' then 'pork_neck'
  when 'veprove' then 'pork'
  when 'hovezi' then 'beef'
  when 'kruti' then 'turkey'
  when 'mlete' then 'minced_meat'
  when 'ryby' then 'fish'
  when 'mrazene maso' then 'meat_frozen'
  when 'uzeniny' then 'cold_cuts'
  when 'marinovane maso' then 'marinated_meat'
  when 'ovoce' then 'fruit_fresh'
  when 'jablko' then 'apples'
  when 'jablka' then 'apples'
  when 'banan' then 'bananas'
  when 'banany' then 'bananas'
  when 'citrusy' then 'fruit_citrus'
  when 'bobulove' then 'fruit_berries'
  when 'exoticke' then 'fruit_exotic'
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
set search_path = public
as $function$
select case
  when p_tag in ('beer','beer_lager','beer_draught','beer_nonalc','beer_radler','beer_can','beer_bottle','beer_multipack','fruit_drink') then 'drinks'
  when p_tag in (
    'milk','milk_fullfat','milk_semiskim','milk_lactosefree','plant_drink','milk_fresh','milk_uht','milk_condensed',
    'bread','rolls','loaf','buns','baguette','sweet_bakery','bread_fresh','bread_packaged','bread_gluten_free',
    'eggs','eggs_chicken','eggs_quail','eggs_m','eggs_l','eggs_free_range','eggs_barn','eggs_bio',
    'butter','butter_classic','butter_ghee','butter_salted','butter_flavoured','butter_block','butter_tub',
    'cheese','eidam','gouda','cheese_hermelin','cheese_mozzarella','cheese_processed','cheese_hard','cheese_soft','cheese_sliced','cheese_grated',
    'meat','chicken','pork_neck','pork','beef','turkey','minced_meat','fish','meat_frozen','cold_cuts','marinated_meat',
    'fruit_fresh','apples','bananas','fruit_citrus','fruit_berries','fruit_exotic','fruit_frozen','fruit_dried',
    'veg_fresh','potatoes','tomatoes','peppers','onions','root_veg','leafy_veg','veg_frozen','veg_preserved','veg_products'
  ) then 'food'
  else null
end;
$function$;

do $migration$
declare
  sig regprocedure;
  d text;
  old text := 'c.semantic_tags @> array[x.semantic_tag]';
  new text := 'public.public_semantic_offer_matches(x.semantic_tag,c.semantic_tags,c.title,c.product_quantity_text)';
begin
  foreach sig in array array[
    'public.get_public_offer_page_filtered(integer,integer,boolean,text,numeric,numeric,boolean,text,text,text,text,text,text)'::regprocedure,
    'public.get_public_offer_facets(boolean,text,numeric,numeric,boolean,text,text,text,text,text)'::regprocedure
  ] loop
    d := pg_get_functiondef(sig);
    if position(old in d) = 0 then
      raise exception 'semantic match expression not found in %', sig;
    end if;
    d := replace(d,old,new);
    execute d;
  end loop;
end;
$migration$;
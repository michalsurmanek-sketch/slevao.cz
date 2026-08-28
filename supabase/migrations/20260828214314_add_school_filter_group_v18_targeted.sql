-- Add school/stationery as a first-class auto-classifier result without rescanning every product.
create or replace function public.infer_product_filter_group_auto(
  p_name text,
  p_category_id uuid default null,
  p_quantity_text text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
stable
set search_path to 'public','pg_temp'
as $function$
declare
  v_category_slug text;
  v_group text := 'other';
  v_tags text[] := '{}'::text[];
  v_search text := concat_ws(' ',coalesce(p_name,''),coalesce(p_quantity_text,''));
  n text := public.normalize_text(v_search);
  q text := public.normalize_text(coalesce(p_quantity_text,''));
  v_source_store text := lower(coalesce(p_metadata->>'source_store_slug',''));
begin
  if p_category_id is not null then
    select c.slug into v_category_slug from public.categories c where c.id=p_category_id;
    v_group := public.infer_public_filter_group(p_name,v_category_slug);
    if v_group <> 'other' then return v_group; end if;
  end if;

  -- v18: school and stationery. OXYBAG is intentionally context-gated because wallets are fashion.
  if n ~ '(^| )(skolni sesit|sesit a[345]|poznamkovy blok|poznamkovy sesit|penal|pastelky|voskovky|temperove barvy|grafitove tuzky|kulickove pero|plnici pero|gumovaci pero|zvyraznovac|kruzitko|skolni aktovka|skolni batoh|studentsky batoh|skolni kufrik|box na sesity|desky na skolni sesity|obal na sesit|sacek na cvicky|sacek na telocvik|sloha a3|poradac do aktovky|college blok|diar skolak)( |$)'
     or n ~ '(^| )(crelando|baagl|stil 365|pilot frixion|centropen|koh i noor)( |$)'
     or (n ~ '(^| )oxybag( |$)' and n ~ '(^| )(sesit|penal|pouzdro|skolni|studentsky|sacek|sloha|box na sesity|desky na cislice|zastera)( |$)') then
    return 'school';
  end if;

  if n ~ '(^| )(sampon[a-z0-9]*|mydlo|deodorant[a-z0-9]*|antiperspirant[a-z0-9]*|sprchov[a-z0-9]*|pletov[a-z0-9]*|telov[a-z0-9]*|micelarni|odlicovac[a-z0-9]*|kosmetik[a-z0-9]*|cistic[a-z0-9]*|cistici[a-z0-9]*|praci|avivaz[a-z0-9]*|wc blok|wc gel|prostredek na nadobi|gel na nadobi|tablety do mycky|pleny|vlhcene ubrousky)( |$)' then return 'drugstore'; end if;
  if n ~ '(^| )(krem[a-z0-9]*|elixir)( |$)'
     and n ~ '(^| )(beauty|plet[a-z0-9]*|vrask[a-z0-9]*|hydrat[a-z0-9]*|vyziv[a-z0-9]*|nocni|denni)( |$)' then return 'drugstore'; end if;
  if n ~ '(^| )(balzam na rty|bronzer|ocni linka|ocni linky|linka na rty|lak na nehty|lesk na rty|bb krem|ocni krem|pletov[a-z0-9]* toner|toner|naplast[a-z0-9]* .*akne|naplast[a-z0-9]* .*nedokonalost[a-z0-9]*|make up|makeup|fluid proti .*vrask[a-z0-9]*|esence .*akne|hydratac[a-z0-9]* esence|zpevnujic[a-z0-9]* esence|zmekcujic[a-z0-9]* esence)( |$)' then return 'drugstore'; end if;
  if n ~ '(^| )(ocni polstark[a-z0-9]*|hydrogelov[a-z0-9]* .*polstark[a-z0-9]*|polstark[a-z0-9]* .*oci)( |$)' then return 'drugstore'; end if;

  if n ~ '(^| )(krmivo|granule|stelivo|pro psy|pro psa|pro kocky|pro zvirata|pamlsk[a-z0-9]*|kapsicky pro psy|kapsicky pro kocky|konzerva pro psy|konzerva pro kocky|whiskas|pedigree|purina|vetamix)( |$)' then return 'pets'; end if;
  if n ~ '(^| )(mikina|teplaky|bunda|halenka|kosile|sukne|tilko|vesta|boxerky|kalhoty|dziny|bluza|tricko|triko|trika|saty|sortky|ponozky|leginy|svetr|kabat|obuv|boty|tenisky|penezenka|penezenky)( |$)' then return 'fashion'; end if;
  if n ~ '(^| )(sklenice|sklenicka|sklenicky|pohar|poharek|poharky)( |$)' then return 'home'; end if;

  if n ~ '(^| )toaletni stolek( |$)' then return 'home'; end if;

  if n ~ '(^| )cokolad[a-z0-9]*( |$)' and n ~ '(^| )tablet[a-z0-9]*( |$)' then return 'food'; end if;
  if v_source_store in ('pilulka','benu','dr-max','drmax')
     and n ~ '(^| )tablet[a-z0-9]*( |$)' then return 'pharmacy'; end if;

  if n ~ '(^| )laminovack[a-z0-9]*( |$)' then return 'electronics'; end if;

  v_group := public.infer_public_filter_group(p_name,null);
  if v_group <> 'other' and v_group <> 'garden' then return v_group; end if;

  v_tags := public.public_offer_semantic_tags(v_search);
  if v_tags && array['beer','beer_lager','beer_draught','beer_nonalc','beer_radler','fruit_drink','plant_drink']::text[] then return 'drinks'; end if;
  if v_tags && array[
    'milk','bread','buns','sweet_bakery','bread_fresh','bread_packaged','bread_gluten_free','rolls','loaf','baguette',
    'eggs','butter','cheese','eidam','gouda','meat','chicken','pork_neck','pork','beef','turkey','minced_meat','meat_fresh','meat_frozen','marinated_meat',
    'fish','cold_cuts','fruit_fresh','apples','bananas','fruit_citrus','fruit_berries','fruit_exotic','fruit_frozen','fruit_dried',
    'veg_fresh','peppers','onions','leafy_veg','veg_products','root_veg','potatoes','tomatoes','veg_frozen','veg_preserved'
  ]::text[] then return 'food'; end if;

  if n ~ '(^| )(mlynek|mlynky|lzice|lzicka|lzicky|nadobi)( |$)' then return 'home'; end if;
  if n ~ '(^| )forma( |$)' and n ~ '(^| )(peceni|zapekaci|dort|muffin|babovk[a-z0-9]*|kolac[a-z0-9]*|chlebicek|chlebick[a-z0-9]*)( |$)' then return 'home'; end if;
  if n ~ '(^| )(polstar|polstare|polstarek|polstarky|povlak na polstar)( |$)' then return 'home'; end if;
  if n ~ '(^| )(ostiepok[a-z0-9]*|poloostiepok[a-z0-9]*|hummus|kreveta|krevety|chobotnice|makronka|makronky|babovka|jerky|jiska|sushi|medovnik|krajic|chilli con carne|salamky|spagety|pepr|candies)( |$)' then return 'food'; end if;
  if n ~ '(^| )(merlot|cabernet|sauvignon|veltliner|cerveza|tonic|kafe|coffee|secco|kombucha)( |$)' then return 'drinks'; end if;
  if n ~ '(^| )elixir( |$)' and q ~ '(^| )[0-9]+( [0-9]+)? l( |$)' then return 'drinks'; end if;
  if n ~ '(^| )(pohovka|pohovky|komoda|komody|kreslo|kresla|stolek|stolky|roleta|rolety|zaves|zavesy|zaclona|zaclony|deka|deky|skrinka|skrinky|talir|talire|misa|miska|lenoska|hrnek|hrnky)( |$)' then return 'home'; end if;
  if n ~ '(^| )(mazivo|mlhovka|mlhovky)( |$)' then return 'auto'; end if;

  if v_group='garden' then return 'garden'; end if;

  if v_source_store in ('cropp','reserved','house','sinsay') then return 'fashion'; end if;
  if v_source_store in ('moebelix','jysk','asko') then return 'home'; end if;

  return 'other';
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable
parallel safe
set search_path to ''
as $function$ select 18; $function$;

update public.products
set name=name
where (
  public.normalize_text(concat_ws(' ',coalesce(name,''),coalesce(quantity_text,''))) ~ '(^| )(skolni sesit|sesit a[345]|poznamkovy blok|poznamkovy sesit|penal|pastelky|voskovky|temperove barvy|grafitove tuzky|kulickove pero|plnici pero|gumovaci pero|zvyraznovac|kruzitko|skolni aktovka|skolni batoh|studentsky batoh|skolni kufrik|box na sesity|desky na skolni sesity|obal na sesit|sacek na cvicky|sacek na telocvik|sloha a3|poradac do aktovky|college blok|diar skolak)( |$)'
  or public.normalize_text(concat_ws(' ',coalesce(name,''),coalesce(quantity_text,''))) ~ '(^| )(crelando|baagl|stil 365|pilot frixion|centropen|koh i noor)( |$)'
  or (
    public.normalize_text(concat_ws(' ',coalesce(name,''),coalesce(quantity_text,''))) ~ '(^| )oxybag( |$)'
    and public.normalize_text(concat_ws(' ',coalesce(name,''),coalesce(quantity_text,''))) ~ '(^| )(sesit|penal|pouzdro|skolni|studentsky|sacek|sloha|box na sesity|desky na cislice|zastera)( |$)'
  )
)
and (
  coalesce(nullif(trim(filter_group),''),'other')='other'
  or coalesce(metadata->>'filter_group_source','')='auto_classifier'
);

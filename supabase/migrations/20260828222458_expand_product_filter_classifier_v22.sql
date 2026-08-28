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
  v_kaufland_category text := coalesce(p_metadata->>'kaufland_category','');
begin
  if p_category_id is not null then
    select c.slug into v_category_slug from public.categories c where c.id=p_category_id;
    v_group := public.infer_public_filter_group(p_name,v_category_slug);
    if v_group <> 'other' then return v_group; end if;
  end if;

  if n ~ '(^| )(skolni sesit|sesit a[345]|poznamkovy blok|poznamkovy sesit|penal|pastelky|voskovky|temperove barvy|grafitove tuzky|kulickove pero|plnici pero|gumovaci pero|zvyraznovac|kruzitko|skolni aktovka|skolni batoh|studentsky batoh|skolni kufrik|box na sesity|desky na skolni sesity|obal na sesit|sacek na cvicky|sacek na telocvik|sloha a3|poradac do aktovky|college blok|diar skolak|bebe friends|mikrotuzk[a-z0-9]*|popisovac[a-z0-9]*|propisk[a-z0-9]*|nekonecna tuzk[a-z0-9]*|fineliner|suche pastel[a-z0-9]*|modelovaci hmota|skicak|frixion|stabilo|desky na sesity|kancelarsky papir|sanon|laminovaci folie|poznamkove listeck[a-z0-9]*|plastove pravitko|mini zvyraznovac[a-z0-9]*|zaznamova kniha|zaznamni kniha|notes blok|podlozka psaci|sacek na prezuvky|kreslici karton|nacrtnik|obal spisovy|paletka malirska|rychlovazac|ubrus na skolni lavici|ukolnicek|kopirovaci papir|papiry barevne|barevne papiry|kapsa na zip|pravitko trojuhelnik|slozka s drukem|korekcni a lepici strojek|ceska abeceda|tabulka abeceda|tuzka student|obalu na sesity|barvy vodove)( |$)'
     or n ~ '(^| )(crelando|baagl|stil 365|pilot frixion|centropen|koh i noor)( |$)'
     or (n ~ '(^| )oxybag( |$)' and n ~ '(^| )(sesit|penal|pouzdro|skolni|studentsky|sacek|sloha|box na sesity|desky na cislice|zastera)( |$)')
     or (n ~ '(^| )orezavatk[a-z0-9]*( |$)' and n !~ '(^| )(wet n wild|kosmet[a-z0-9]*|elektrick[a-z0-9]*)( |$)') then
    return 'school';
  end if;

  if n ~ '(^| )(sampon[a-z0-9]*|mydlo|deodorant[a-z0-9]*|antiperspirant[a-z0-9]*|sprchov[a-z0-9]*|pletov[a-z0-9]*|telov[a-z0-9]*|micelarni|odlicovac[a-z0-9]*|kosmetik[a-z0-9]*|cistic[a-z0-9]*|cistici[a-z0-9]*|praci|avivaz[a-z0-9]*|wc blok|wc gel|prostredek na nadobi|gel na nadobi|tablety do mycky|pleny|vlhcene ubrousky)( |$)' then return 'drugstore'; end if;
  if n ~ '(^| )(krem[a-z0-9]*|elixir)( |$)'
     and n ~ '(^| )(beauty|plet[a-z0-9]*|vrask[a-z0-9]*|hydrat[a-z0-9]*|vyziv[a-z0-9]*|nocni|denni)( |$)' then return 'drugstore'; end if;
  if n ~ '(^| )(balzam na rty|bronzer|ocni linka|ocni linky|linka na rty|lak na nehty|lesk na rty|bb krem|ocni krem|pletov[a-z0-9]* toner|toner|naplast[a-z0-9]* .*akne|naplast[a-z0-9]* .*nedokonalost[a-z0-9]*|make up|makeup|fluid proti .*vrask[a-z0-9]*|esence .*akne|hydratac[a-z0-9]* esence|zpevnujic[a-z0-9]* esence|zmekcujic[a-z0-9]* esence)( |$)' then return 'drugstore'; end if;
  if n ~ '(^| )(ocni polstark[a-z0-9]*|hydrogelov[a-z0-9]* .*polstark[a-z0-9]*|polstark[a-z0-9]* .*oci)( |$)' then return 'drugstore'; end if;
  if n ~ '(^| )(fungispray chlorovy|nahradni hlavice do holiciho strojku|jar platinum plus kapsle|listerine|parodontax|gel color pro barevne pradlo|mezizubni kartacky|odstranovac skvrn|tp ritual)( |$)' then return 'drugstore'; end if;

  if n ~ '(^| )mullermilch( |$)' then return 'drinks'; end if;
  if n ~ '(^| )(primitivo puglia|rulanske sede|tramin|cinzano|diplomatico|doppio passo|tuzemak|fizi drink|granini .*stava|heffron|jagermeister|summer ale|martini bianco|metaxa|robby bubble|chardonnay|stara myslivecka|strongbow cider|vincentka|palava 750|veltlin[a-z0-9]* zelene)( |$)'
     or (n ~ '(^| )gemerka( |$)' and n !~ '(^| )(magnesium|vapnik|horcik)( |$)') then
    return 'drinks';
  end if;

  if n ~ '(^| )(dresink[a-z0-9]*|salatov[a-z0-9]* zalivk[a-z0-9]*|chilli olej|korenici smes|studentsky mix|papri chup|mlekarna kunin|susene ovocne rolovane platky|kinder cokoladova vajicka|opavia zlate venecky|cookies coko|tykev .*hokkaido|tilsiter|choco balls|tortillas salt|pomazankove neochucene|fuet extra|zavinace|strudl tvarohovy|zbojnicka placka|majka|kysele zizalky|hejk|hoki|lay s salted|nimm2|mlecne housticky|studentska pecet|pom bar|med kvetovy|sojacik|tofu uzene|tic tac|miamo myval tvarohovy|toffifee|balsyr|brusnice klikva|kabanosky|precliky solene|slehacka spray|slunecnice loupana|grana padano)( |$)'
     or (n ~ '(^| )pistacie( |$)' and n !~ '(^| )(sprchov[a-z0-9]*|gel|sampon[a-z0-9]*|kosmetik[a-z0-9]*)( |$)') then
    return 'food';
  end if;

  if n ~ '(^| )(krmivo|granule|stelivo|pro psy|pro psa|pro kocky|pro zvirata|pamlsk[a-z0-9]*|kapsicky pro psy|kapsicky pro kocky|konzerva pro psy|konzerva pro kocky|whiskas|pedigree|purina|vetamix)( |$)' then return 'pets'; end if;
  if n ~ '(^| )(skrabadlo|podlozka na krmeni|skrabacich rohozek)( |$)' then return 'pets'; end if;

  if n ~ '(^| )(smes do ostrikovacu|kanystr na pohonne hmoty|modulator do auta|autovune|drzak .*ventilacni mrizky)( |$)' then return 'auto'; end if;

  if n ~ '(^| )(mikina|teplaky|bunda|halenka|kosile|sukne|tilko|vesta|boxerky|kalhoty|dziny|bluza|tricko|triko|trika|saty|sortky|ponozky|leginy|svetr|kabat|obuv|boty|tenisky|penezenka|penezenky|fusakle detske|kalhotky det|slipy det|holinky|jarmilky|platenky|sport ob det|ob vol cas det|ob do vody da|zateplene phylony)( |$)' then return 'fashion'; end if;

  if n ~ '(^| )(doza plastov[a-z0-9]*|sada doz plastov[a-z0-9]*|cajove svicky|metla na slehani|naberacka|obracecka|sada mis|plech na peceni|napenovac mleka|box s vikem|ulozny box|odpadkovy kos|kos bezdotykovy|folie potravinova|doza na potraviny|vonny vosk|susak na pradlo|kos na ciste pradlo|smetacek s lopatkou|zehlici prkno)( |$)' then return 'home'; end if;
  if n ~ '(^| )(sklenice|sklenicka|sklenicky|pohar|poharek|poharky)( |$)' then return 'home'; end if;
  if n ~ '(^| )toaletni stolek( |$)' then return 'home'; end if;

  if n ~ '(^| )cokolad[a-z0-9]*( |$)' and n ~ '(^| )tablet[a-z0-9]*( |$)' then return 'food'; end if;
  if v_source_store in ('pilulka','benu','dr-max','drmax')
     and n ~ '(^| )tablet[a-z0-9]*( |$)' then return 'pharmacy'; end if;

  if n ~ '(^| )(laminovack[a-z0-9]*|chytre hodinky|powerbanka|skartovack[a-z0-9]*)( |$)' then return 'electronics'; end if;

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

  if v_kaufland_category='Ovoce, zelenina, rostliny'
     and n ~ '(^| )(chryzantema|dracinec|kytice|orchidea|ruze|sachor|cyperus|zamioculcas)( |$)' then return 'garden'; end if;
  if v_kaufland_category='Ovoce, zelenina, rostliny'
     and n ~ '(^| )(mucenka|passionfruit)( |$)' then return 'food'; end if;
  if v_kaufland_category='Drogerie, dětská výživa a péče, krmiva'
     and n ~ '(^| )(prebalovaci podlozk[a-z0-9]*|kosmeticke ubrousk[a-z0-9]*|kondom[a-z0-9]*|nahradni hlavic[a-z0-9]*|nahradni brit[a-z0-9]*)( |$)' then return 'drugstore'; end if;
  if v_kaufland_category='Dům, domácnost'
     and n ~ '(^| )stropni led svetlo( |$)' then return 'home'; end if;
  if v_kaufland_category in ('Mléčné výrobky, tuky, vejce','Mražené','Základní potraviny, pečivo','Maso, drůbež, uzeniny')
     and n !~ '(^| )(napoj[a-z0-9]*|drink|coffee|kava)( |$)' then return 'food'; end if;

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
as $function$ select 22; $function$;

update public.products
set name=name
where coalesce(nullif(trim(filter_group),''),'other')='other'
and (
  public.normalize_text(concat_ws(' ',coalesce(name,''),coalesce(quantity_text,''))) ~ '(^| )(zaznamova kniha|zaznamni kniha|notes blok|podlozka psaci|sacek na prezuvky|kreslici karton|nacrtnik|obal spisovy|paletka malirska|rychlovazac|ubrus na skolni lavici|ukolnicek|kopirovaci papir|papiry barevne|barevne papiry|kapsa na zip|pravitko trojuhelnik|slozka s drukem|korekcni a lepici strojek|ceska abeceda|tabulka abeceda|tuzka student|obalu na sesity|barvy vodove|cookies coko|tykev .*hokkaido|tilsiter|choco balls|tortillas salt|pomazankove neochucene|fuet extra|zavinace|strudl tvarohovy|zbojnicka placka|majka|kysele zizalky|hejk|hoki|lay s salted|nimm2|mlecne housticky|studentska pecet|pom bar|med kvetovy|sojacik|tofu uzene|tic tac|miamo myval tvarohovy|toffifee|balsyr|brusnice klikva|kabanosky|precliky solene|slehacka spray|slunecnice loupana|grana padano|primitivo puglia|rulanske sede|tramin|cinzano|diplomatico|doppio passo|tuzemak|fizi drink|granini .*stava|heffron|jagermeister|summer ale|martini bianco|metaxa|robby bubble|chardonnay|stara myslivecka|strongbow cider|vincentka|palava 750|veltlin[a-z0-9]* zelene|box s vikem|ulozny box|odpadkovy kos|kos bezdotykovy|folie potravinova|doza na potraviny|vonny vosk|susak na pradlo|kos na ciste pradlo|smetacek s lopatkou|zehlici prkno|fungispray chlorovy|nahradni hlavice do holiciho strojku|jar platinum plus kapsle|listerine|parodontax|gel color pro barevne pradlo|mezizubni kartacky|odstranovac skvrn|tp ritual|fusakle detske|kalhotky det|slipy det|holinky|jarmilky|platenky|sport ob det|ob vol cas det|ob do vody da|zateplene phylony|autovune|drzak .*ventilacni mrizky)( |$)'
  or (
    public.normalize_text(concat_ws(' ',coalesce(name,''),coalesce(quantity_text,''))) ~ '(^| )gemerka( |$)'
    and public.normalize_text(concat_ws(' ',coalesce(name,''),coalesce(quantity_text,''))) !~ '(^| )(magnesium|vapnik|horcik)( |$)'
  )
);
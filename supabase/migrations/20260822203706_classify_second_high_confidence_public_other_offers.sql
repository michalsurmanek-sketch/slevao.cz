create or replace function public.resolve_public_filter_group(
  p_name text,
  p_category_slug text default null::text,
  p_store_slug text default null::text
)
returns text
language plpgsql
immutable
parallel safe
set search_path to 'public', 'pg_temp'
as $function$
declare
  base_group text := public.infer_public_filter_group(p_name, p_category_slug);
  n text := public.normalize_text(coalesce(p_name,''));
begin
  if base_group <> 'other' then
    return base_group;
  end if;

  if p_store_slug = 'kaufland' and n ~ '\m(parkside|livarno)\M' then
    return 'home';
  end if;

  if p_store_slug = any (array['cropp','house','reserved','takko','ca']) then
    return 'fashion';
  end if;

  if p_store_slug = any (array['asko','jysk','ikea','bauhaus','pro-doma','dek','obi']) then
    return 'home';
  end if;

  if n ~ '\m(powerbanka|power bank)\M' then
    return 'electronics';
  end if;

  if n ~ '\m(prosteradlo|koberec|koberecek|doza|dozy|uterka|podsedak|piknikova deka|chladici box|chladici taska|davkovac napoju|balici paska)\M' then
    return 'home';
  end if;

  if n ~ '\m(grilovaci tacky|grilovaci jehly|grilovaci kleste|grilovaci lopatka|rozpalovac uhli)\M'
     or n ~ '\m(bazen|bazenek)\M' then
    return 'garden';
  end if;

  if n ~ '\m(peeling|korektor|natacky|nalepky na nehty|maska na rty|koupel na nohy|hydratacni pece)\M' then
    return 'drugstore';
  end if;

  if n ~ '\m(branik|budvar|breznak|holba|ostravar|pardal|radegast|mattoni|jihlavanka)\M' then
    return 'drinks';
  end if;

  if n ~ '\m(pudink|ratatouille|topinky|zeleninova smes|blumy|delissa|minonky|pom bar|sojovy suk|syrove nite|toppoki|eskymo)\M'
     or n ~ '\mfruit gummies\M'
     or n ~ '\m(copanek jablecny|amoretta desserts)\M'
     or n ~ '\m(salami|spekacek|spekacky)\M'
     or n ~ '\molej\M[[:space:]]+\m(repkovy|slunecnicovy|olivovy)\M'
     or (n ~ '\m(alpska|himalajska)\M.*\msul\M' and n !~ '\m(mlynek|koupel|do koupele)\M')
     or (n ~ '\mmorska\M.*\msul\M' and n !~ '\m(mlynek|koupel|do koupele|mrtve more)\M') then
    return 'food';
  end if;

  -- Second high-confidence fallback layer. These run only after all canonical,
  -- product-level and store-family classifications above have returned other.
  if n ~ '\m(pyzamo|kalhotky|pantofle|papuce|tenisky|sneaker|pareo|bermudy|bikiny|bikin|kratasy|kabelka|sako|skort|nazouvaky|boty)\M' then
    return 'fashion';
  end if;

  if n ~ '\m(precliky|datle|emental|tvaruzky|sushi|krekry|smazenka|petrzel|vlasska jadra|rolada|pletenec|syrove tycky|rukola|zmrzlinovy dort|minisekana|luncheon meat|tagliatelle|bulgur|strouhany kokos|makronky|pohanka|grissini|ricotta|penne|rizoto)\M' then
    return 'food';
  end if;

  if n ~ '\m(spritzbitter|ondrasovka|chenin blanc|capri sun|gambrinus|birell|becherovka|gemerka)\M' then
    return 'drinks';
  end if;

  if n ~ '\m(fixacni sprej|tvarenka|pletovy gel|primer|rozjasnovac|oboci|naplasti proti akne)\M' then
    return 'drugstore';
  end if;

  if n ~ '\m(stojan na kvetiny|podpalovac|pudni vitaminy)\M' then
    return 'garden';
  end if;

  if n ~ '\m(tlumic perovani|autochladicka|snehove retezy|wd-40)\M' then
    return 'auto';
  end if;

  if n ~ '\m(dekorace|svicen|cajove svicky)\M' then
    return 'home';
  end if;

  return base_group;
end;
$function$;

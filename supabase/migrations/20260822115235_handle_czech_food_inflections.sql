-- Handle common Czech inflections for produce without using loose substring
-- matching. Specific drink/non-food guards remain before this food fallback.

create or replace function public.infer_public_filter_group(
  p_name text,
  p_category_slug text default null
)
returns text
language plpgsql
immutable
parallel safe
set search_path to 'public', 'pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(p_name,''));
begin
  return case
    when p_category_slug in ('maso-ryby','mlecne-vyrobky','ovoce-zelenina','pecivo','sladkosti','trvanlive-potraviny') then 'food'
    when p_category_slug='napoje' then 'drinks'
    when p_category_slug='drogerie' then 'drugstore'
    when p_category_slug='domacnost' then 'home'
    when p_category_slug='elektronika' then 'electronics'
    when p_category_slug='moda' then 'fashion'
    when p_category_slug='lekarna' then 'pharmacy'
    when p_category_slug='zvirata' then 'pets'
    when p_category_slug='zahrada' then 'garden'
    when p_category_slug='auto' then 'auto'

    when n ~ '\m(sampon|mydlo|deodorant|zubni|ustni|pletova|telove|avivaz|cistic|toaletni|plenky|kosmetika|antiperspirant|serum|makeup|dezinfekce|micelarni|odlicovac|rtenka|rasenka|praci|mycka)\M' then 'drugstore'
    when n ~ '\m(dolce gusto|nespresso|tassimo|kavove kapsle|kapsle do kavovaru|starbucks kapsle)\M' then 'drinks'
    when n ~ '\m(vitamin|lecivo|lekarn|ibuprofen|paralen|magnesium|calcium|probiot|dr max|corega)\M' then 'pharmacy'
    when n ~ '\m(telefon|mobil|notebook|televize|sluchatka|pocitac|monitor|kabel)\M' then 'electronics'
    when n ~ '\mtablet\M' and n !~ '\m(sumiv|vitamin|magnesium|calcium|dr max|lecivo|lekarn)\M' then 'electronics'
    when n ~ '\m(krmivo|granule|stelivo|whiskas|pedigree|purina)\M' then 'pets'
    when n ~ '\m(mikina|teplaky|bunda|halenka|kosile|sukne|tilko|vesta|boxerky|kalhoty|dziny|bluza|tricko|saty|sortky|ponozky|kosilka|ksiltovka|leginy|svetr|kabat)\M' then 'fashion'
    when n ~ '\m(zahrada|sekacka|substrat|kvetinac|gril|cerpadlo|hadice|komposter)\M' then 'garden'
    when n ~ '\m(nabytek|skrin|postel|stul|zidle|sedacka|drez|dlazba|naradi|svitidlo|zarovka|hrnec|panev|povleceni|rucnik)\M' then 'home'
    when n ~ '\m(pivo|lezak|radler|vino|prosecco|mineralka|limonada|cola|dzus|juice|nektar|energy|kava|caj)\M' then 'drinks'
    when n ~ '\mvoda\M' and n !~ '\m(pletova|ustni|micelarni|toaletni|po holeni)\M' then 'drinks'
    when n ~ '\m(veprovy|veprova|veprove|hovezi|kureci|kruti|kachni|jehneci|kralici|krkovice|kyta|plec|kotleta|panenka|svickova|steak|bucek|sunka|salam|klobasa|parek|slanina|ryba|losos|treska|tunak|kapr|pstruh|makrela|mleko|jogurt|tvaroh|syr|eidam|gouda|hermelin|mozzarella|maslo|smetana|kefir|chleb|rohlik|houska|bageta|croissant|kobliha|kolac|pecivo|cokolada|bonbon|susenk|oplatka|tycinka|mouka|ryze|testoviny|fazole|cocka)\M' then 'food'

    when n ~ '\m(motorovy olej|motorovy|pneumatika|sterac|brzdov|chladici kapalina|autokosmetik)\M' then 'auto'
    when n ~ '\m(vonne tycinky|aroma tycinky|vonny olej|difuzer|svicka|svice|pohlcovac vlhkosti|balici papir|papir na peceni|pytle na odpadky)\M' then 'home'
    when n ~ '\m(sprchovy gel|sprchovy krem|wc blok|wc gel|damske vlozky|slipove vlozky|tampony|lak na vlasy|telovy peeling|denni krem|krem na nohy|cistici prostredek|myci prostredek|prostredek na nadobi|osvezovac vzduchu|vlhcene ubrousky|papirove kapesniky|repelent|antibakterial)\M'
      or n ~ '\mcif\M.*\mkrem\M'
      or n ~ '\mpur\M.*\mprostredek\M'
      then 'drugstore'
    when n ~ '\m(kapsicky pro kocky|kapsicky pro psy|pochoutka pro kocky|pochoutka pro psy|konzerva pro kocky|konzerva pro psy|pastika .* pro psy|pastika .* pro kocky)\M' then 'pets'
    when n ~ '\m(napoj|vodka|gin|rum|whisky|whiskey|liker|lihovina|aperol|fernet|prosecco|sirup|mineralka|kyselka|radler|lezak|pivo|nealko|sladovy napoj|cola|pepsi|mirinda|dzus|juice|nektar|smoothie|ice coffee)\M' then 'drinks'
    when n ~ '\m(mango|malina|jahoda|citron|pomeranc|jablko|broskev)\M.*\m[0-9]+([.,][0-9]+)?[[:space:]]*(ml|l)\M' then 'drinks'

    when n ~ '\m(avokad[a-z]*|banan[a-z]*|boruvk[a-z]*|brambor[a-z]*|citron[a-z]*|grep[a-z]*|fik[a-z]*|hrozn[a-z]*|jablk[a-z]*|jahod[a-z]*|malin[a-z]*|mandarink[a-z]*|merunk[a-z]*|nektarink[a-z]*|pomeranc[a-z]*|broskv[a-z]*|svestk[a-z]*|hrusk[a-z]*|ananas[a-z]*|mango|kiwi|meloun[a-z]*|rajcat[a-z]*|okurk[a-z]*|paprik[a-z]*|cuket[a-z]*|mrkv[a-z]*|cibul[a-z]*|cesnek[a-z]*|zeli|repa|kukuric[a-z]*|spenat[a-z]*|kvetak[a-z]*|brokolic[a-z]*|redkv[a-z]*|celer[a-z]*|porek)\M' then 'food'

    when n ~ '\m(avokad|banan|boruvk|brambor|citron|grep|fiky|hrozn|jablk|jahod|malin|mandarink|merunk|nektarink|pomeranc|broskv|svestk|hrusk|ananas|mango|kiwi|meloun|rajcat|okurk|paprik|cuketa|mrkev|cibul|cesnek|zeli|repa|kukuric|spenat|kvetak|brokolic|redkv|celer|porek|vejce|zmrzlina|sorbet|nanuk|kornout|chips|bramburky|krupky|musli|vlocky|cereali|quinoa|arasid|mandle|pistac|kesu|olivy|horcice|pastika|majonez|tatarsk|kecup|pomazank|bujon|puding|pizza|hranolky|knedlik|donut|brioska|listove testo|mouka|cukr|jedla sul|kase|sekan|uzenin|spekack|pecen|salat|susene ovoce|sojovy vyrobek|vegetarians|piskot|tatrank|bonbon|zele|dezert|svacinka|tortilla|mascarpone|filet|rybi|dzem|cizrna|zampiony|houby|seminka|snack|kuskus|cottage|cheddar|halloumi|cokolad|lupinky|presnidavka)\M'
      or n ~ '\m(repkovy olej|slunecnicovy olej|olivovy olej|jedly olej)\M'
      or (n ~ '\mtycinky\M' and n !~ '\m(vonne|aroma|difuzer|incense|lepici|tavne)\M')
      or (n ~ '\morechy\M' and n !~ '\m(dekor|folie|dekorace|barva)\M')
      then 'food'
    else 'other'
  end;
end;
$function$;

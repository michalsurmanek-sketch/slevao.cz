create or replace function public.public_offer_semantic_tags(p_search text)
returns text[]
language plpgsql
immutable parallel safe
set search_path to 'public', 'pg_temp'
as $function$
declare
  s text := public.normalize_text(coalesce(p_search,''));
  tags text[] := '{}'::text[];
  beer boolean;
  milk boolean;
  bread boolean;
  eggs boolean;
  butter boolean;
  cheese boolean;
  meat boolean;
  chicken boolean;
  prsa_meat boolean;
  pet_context boolean;
  meat_alternative boolean;
  meat_species boolean;
  meat_cut boolean;
  meat_direct boolean;
  processed_meat boolean;
  seasoning_context boolean;
  meat_context boolean;
  fruit_any boolean;
  fruit boolean;
  veg boolean;
begin
  beer := s ~ '(^| )(pivo|pivni|lezak|radler|pils[a-z0-9]*|porter|stout)( |$)';
  milk := s ~ '(^| )(mleko|mlecny|mlecne|plnotuc[a-z0-9]*|polotuc[a-z0-9]*|odtuc[a-z0-9]*|bezlaktoz[a-z0-9]*|kondenzovan[a-z0-9]*)( |$)';
  bread := s ~ '(^| )(peciv[a-z0-9]*|chleb[a-z0-9]*|rohlik[a-z0-9]*|housk[a-z0-9]*|baget[a-z0-9]*|veka|dalam[a-z0-9]*|kaiser[a-z0-9]*|toast[a-z0-9]*|koblih[a-z0-9]*|croissant[a-z0-9]*|kolac[a-z0-9]*|buchta|zavin[a-z0-9]*|snek)( |$)'
    and s !~ '(^| )zavinace( |$)';
  eggs := s ~ '(^| )(vejce|vajec[a-z0-9]*)( |$)';
  butter := s ~ '(^| )(maslo|maslicko|ghee|ghi)( |$)';
  cheese := s ~ '(^| )(syr[a-z0-9]*|eidam[a-z0-9]*|gouda|emental[a-z0-9]*|hermelin[a-z0-9]*|niva|mozzarell[a-z0-9]*|cheddar[a-z0-9]*|parenic[a-z0-9]*|korbac[a-z0-9]*|balkansk[a-z0-9]*|cottage)( |$)';

  -- Rychlé filtry popisují hlavní typ výrobku, ne ingredienci v názvu.
  if bread then
    milk := false;
    eggs := false;
    butter := false;
    cheese := false;
  end if;

  prsa_meat := s ~ '(^| )prsa( |$)'
    and s !~ '(^| )(paska|podprsenk[a-z0-9]*|nalepk[a-z0-9]*|ochran[a-z0-9]*|bradavk[a-z0-9]*|kosmetik[a-z0-9]*|odev[a-z0-9]*|trick[a-z0-9]*|top|plavk[a-z0-9]*)( |$)';

  pet_context := s ~ '(^| )(akinu|dingo|dog snaq|prevital|vetamix|vitakraft|shinycat|huhubamboo|propesko|felix fantastic|whiskas|pedigree|purina|darling|rewards)( |$)'
    or s ~ '(^| )(pro psy|pro kocky|pro psa|granule|pamlsk[a-z0-9]*|krmivo|kapsicky pro)( |$)';
  meat_alternative := s ~ '(^| )(alternativ[a-z0-9]*|vegetari[a-z0-9]*|vegansk[a-z0-9]*|rostlinn[a-z0-9]*|veggie)( |$)'
    and s ~ '(^| )masov[a-z0-9]*( |$)';

  seasoning_context := s ~ '(^| )(vitana|maggi|knorr)( |$)';
  processed_meat := s ~ '(^| )(pastik[a-z0-9]*|pate|krem[a-z0-9]*|pomazank[a-z0-9]*|parek|parky|pareck[a-z0-9]*|klobas[a-z0-9]*|sunk[a-z0-9]*|tlacenk[a-z0-9]*|luncheon[a-z0-9]*|konzerv[a-z0-9]*|sadlo|skvark[a-z0-9]*|nuget[a-z0-9]*|strips[a-z0-9]*|spiz[a-z0-9]*|cevap[a-z0-9]*|burger[a-z0-9]*|instant[a-z0-9]*|nudl[a-z0-9]*|prichut[a-z0-9]*|polevk[a-z0-9]*|vyvar[a-z0-9]*|omack[a-z0-9]*|koreni|bujon[a-z0-9]*|hotov[a-z0-9]*|susene|suseny|susena|uzenin[a-z0-9]*|uzene|uzeny|uzena|rolk[a-z0-9]*|grilset[a-z0-9]*|knedlik[a-z0-9]*|holandsk[a-z0-9]*|trhan[a-z0-9]*|gulas)( |$)'
    or s ~ '(^| )(pecene|peceny|pecena) (kure|maso|veprove|hovezi)( |$)'
    or s ~ '(^| )sous vide( |$)';

  meat_species := s ~ '(^| )(vepr[a-z0-9]*|hovez[a-z0-9]*|kure|kurec[a-z0-9]*|kruti|kruta|kruty|kachn[a-z0-9]*|jehnec[a-z0-9]*|kralic[a-z0-9]*|angus)( |$)';
  meat_cut := prsa_meat
    or s ~ '(^| )(krkovic[a-z0-9]*|kyta|plec|kotlet[a-z0-9]*|panenk[a-z0-9]*|svickov[a-z0-9]*|rosten[a-z0-9]*|hrudi|zebir[a-z0-9]*|zebro|zeber|bucek|koleno|jatr[a-z0-9]*|steh[a-z0-9]*|kridl[a-z0-9]*|filet[a-z0-9]*|kli[zž]k[a-z0-9]*|licka|bok|eyeround|sirloin|ribeye|flank|brisket|ribs|nudlick[a-z0-9]*)( |$)'
    or (meat_species and s ~ '(^| )(steak[a-z0-9]*|rizek|rizky|mlete|mlety|mleta|melnene|melneneho)( |$)')
    or s ~ '(^| )gulasov[a-z0-9]* maso( |$)'
    or s ~ '(^| )vepr[a-z0-9]* pecen[a-z0-9]*( |$)';
  meat_direct := s ~ '(^| )maso( |$)';

  meat_context := meat_species or meat_cut or meat_direct or processed_meat;
  meat := (meat_cut or meat_direct or (s ~ '(^| )kure( |$)' and not seasoning_context))
    and not processed_meat
    and not seasoning_context
    and not pet_context
    and not meat_alternative
    and not bread;

  chicken := meat and (s ~ '(^| )(kure|kurec[a-z0-9]*)( |$)' or prsa_meat);

  -- Skutečné maso může mít v názvu sýr/ovoce/zeleninu jako přísadu nebo marinádu.
  -- Tyto vedlejší výrazy nesmí přehodit produkt do jiného rychlého filtru.
  if meat then
    milk := false;
    eggs := false;
    butter := false;
    cheese := false;
  end if;

  fruit_any := s ~ '(^| )(jablk[a-z0-9]*|hrusk[a-z0-9]*|banan[a-z0-9]*|pomeranc[a-z0-9]*|mandarink[a-z0-9]*|citron[a-z0-9]*|limet[a-z0-9]*|grep[a-z0-9]*|hrozn[a-z0-9]*|jahod[a-z0-9]*|malin[a-z0-9]*|boruv[a-z0-9]*|ostruzin[a-z0-9]*|rybiz[a-z0-9]*|tresn[a-z0-9]*|visn[a-z0-9]*|merunk[a-z0-9]*|broskv[a-z0-9]*|nektarink[a-z0-9]*|svestk[a-z0-9]*|mango|ananas[a-z0-9]*|avokad[a-z0-9]*|kiwi|meloun[a-z0-9]*|maraku[a-z0-9]*|papaj[a-z0-9]*)( |$)';
  fruit := fruit_any
    and not meat_context
    and s !~ '(^| )(napoj[a-z0-9]*|dzus[a-z0-9]*|juice|nektar|stava|smoothie|sirup[a-z0-9]*|syrob[a-z0-9]*|liker[a-z0-9]*|rum|vodka|gin|vino|pivo|cider|jogurt[a-z0-9]*|dezert[a-z0-9]*|tycink[a-z0-9]*|bonbon[a-z0-9]*|cokolad[a-z0-9]*|zmrzlin[a-z0-9]*|dzem[a-z0-9]*|marmelad[a-z0-9]*|kompot[a-z0-9]*|pyre|caj|susen[a-z0-9]*|lyo[a-z0-9]*|lyofiliz[a-z0-9]*|mrazen[a-z0-9]*|kandovan[a-z0-9]*|ovocn[a-z0-9]*|prichut[a-z0-9]*|zubni|pasta|tablet[a-z0-9]*|vitamin[a-z0-9]*|gummies|rasenk[a-z0-9]*|kosmetik[a-z0-9]*|prostred[a-z0-9]*|cistic[a-z0-9]*|mydlo|sampon[a-z0-9]*|aroma|vlhkost[a-z0-9]*|latex[a-z0-9]*|hrack[a-z0-9]*|halenk[a-z0-9]*|legin[a-z0-9]*|kosil[a-z0-9]*|susenk[a-z0-9]*|knedlik[a-z0-9]*|kapsick[a-z0-9]*|presnid[a-z0-9]*|svacink[a-z0-9]*|povidl[a-z0-9]*|snack[a-z0-9]*|krekry|takis|fuego)( |$)';
  veg := s ~ '(^| )(brambor[a-z0-9]*|cibul[a-z0-9]*|cesnek[a-z0-9]*|rajcat[a-z0-9]*|paprik[a-z0-9]*|okurk[a-z0-9]*|mrkev|petrzel|celer[a-z0-9]*|kedlub[a-z0-9]*|kvetak[a-z0-9]*|brokolic[a-z0-9]*|cuket[a-z0-9]*|lilek|redkv[a-z0-9]*|repa|kapust[a-z0-9]*|zeli|salat[a-z0-9]*|spenat[a-z0-9]*|hras[a-z0-9]*|kukuric[a-z0-9]*|fazol[a-z0-9]*)( |$)'
    and not meat_context
    and s !~ '(^| )(napoj[a-z0-9]*|dzus[a-z0-9]*|stava|smoothie|pomazank[a-z0-9]*|protlak[a-z0-9]*|pyre|omack[a-z0-9]*|chips[a-z0-9]*|syrov[a-z0-9]*|syr[a-z0-9]*|tunak[a-z0-9]*|lahudk[a-z0-9]*|hotov[a-z0-9]*)( |$)';

  if beer then tags:=array_append(tags,'beer'); end if;
  if milk then tags:=array_append(tags,'milk'); end if;
  if bread then tags:=array_append(tags,'bread'); end if;
  if s ~ '(^| )rohlik[a-z0-9]*( |$)' then tags:=array_append(tags,'rolls'); end if;
  if s ~ '(^| )chleb[a-z0-9]*( |$)' then tags:=array_append(tags,'loaf'); end if;
  if s ~ '(^| )baget[a-z0-9]*( |$)' then tags:=array_append(tags,'baguette'); end if;
  if eggs then tags:=array_append(tags,'eggs'); end if;
  if butter then tags:=array_append(tags,'butter'); end if;
  if cheese then tags:=array_append(tags,'cheese'); end if;
  if s ~ '(^| )eidam[a-z0-9]*( |$)' and not bread and not meat then tags:=array_append(tags,'eidam'); end if;
  if s ~ '(^| )gouda( |$)' and not bread and not meat then tags:=array_append(tags,'gouda'); end if;
  if meat then tags:=array_append(tags,'meat'); end if;
  if chicken then tags:=array_append(tags,'chicken'); end if;
  if meat and s ~ '(^| )krkovic[a-z0-9]*( |$)' then tags:=array_append(tags,'pork_neck'); end if;
  if meat and s ~ '(^| )(vepr[a-z0-9]*|krkovic[a-z0-9]*|kyta|plec|kotlet[a-z0-9]*|panenk[a-z0-9]*|bucek|koleno)( |$)' then tags:=array_append(tags,'pork'); end if;
  if meat and s ~ '(^| )(hovez[a-z0-9]*|angus|eyeround|sirloin|ribeye|rosten[a-z0-9]*)( |$)' then tags:=array_append(tags,'beef'); end if;
  if fruit then tags:=array_append(tags,'fruit_fresh'); end if;
  if fruit and s ~ '(^| )jablk[a-z0-9]*( |$)' then tags:=array_append(tags,'apples'); end if;
  if fruit and s ~ '(^| )banan[a-z0-9]*( |$)' then tags:=array_append(tags,'bananas'); end if;
  if fruit_any and not meat_context and s ~ '(^| )mrazen[a-z0-9]*( |$)' then tags:=array_append(tags,'fruit_frozen'); end if;
  if fruit_any and not meat_context and s ~ '(^| )susen[a-z0-9]*( |$)' then tags:=array_append(tags,'fruit_dried'); end if;
  if not meat_context and s ~ '(^| )(ovocn[a-z0-9]*|jablk[a-z0-9]*|pomeranc[a-z0-9]*|mango|ananas[a-z0-9]*)( |$)'
     and s ~ '(^| )(napoj[a-z0-9]*|dzus[a-z0-9]*|nektar|stava|smoothie)( |$)' then tags:=array_append(tags,'fruit_drink'); end if;
  if veg then tags:=array_append(tags,'veg_fresh'); end if;
  if veg and s ~ '(^| )brambor[a-z0-9]*( |$)' then tags:=array_append(tags,'potatoes'); end if;
  if veg and s ~ '(^| )rajcat[a-z0-9]*( |$)' then tags:=array_append(tags,'tomatoes'); end if;
  if veg and s ~ '(^| )mrazen[a-z0-9]*( |$)' then tags:=array_append(tags,'veg_frozen'); end if;
  if not meat_context and s ~ '(^| )(steril[a-z0-9]*|naklad[a-z0-9]*|konzerv[a-z0-9]*)( |$)'
     and s ~ '(^| )(zelenin[a-z0-9]*|okurk[a-z0-9]*|paprik[a-z0-9]*|hras[a-z0-9]*|kukuric[a-z0-9]*|fazol[a-z0-9]*)( |$)' then tags:=array_append(tags,'veg_preserved'); end if;

  return array(select distinct x from unnest(tags) x order by x);
end;
$function$;

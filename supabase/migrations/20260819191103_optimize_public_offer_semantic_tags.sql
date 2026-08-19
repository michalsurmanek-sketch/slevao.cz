create or replace function public.public_offer_semantic_tags(p_search text)
returns text[]
language plpgsql
immutable
parallel safe
set search_path = public, pg_temp
as $$
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
  fruit_any boolean;
  fruit boolean;
  veg boolean;
begin
  beer := s ~ '\m(pivo|pivni|lezak|radler|pils[a-z0-9]*|porter|stout)\M';
  milk := s ~ '\m(mleko|mlecny|mlecne|plnotuc[a-z0-9]*|polotuc[a-z0-9]*|odtuc[a-z0-9]*|bezlaktoz[a-z0-9]*|kondenzovan[a-z0-9]*)\M';
  bread := s ~ '\m(peciv[a-z0-9]*|chleb[a-z0-9]*|rohlik[a-z0-9]*|housk[a-z0-9]*|baget[a-z0-9]*|veka|dalam[a-z0-9]*|kaiser[a-z0-9]*|toast[a-z0-9]*|koblih[a-z0-9]*|croissant[a-z0-9]*|kolac[a-z0-9]*|buchta|zavin[a-z0-9]*|snek)\M';
  eggs := s ~ '\m(vejce|vajec[a-z0-9]*)\M';
  butter := s ~ '\m(maslo|maslicko|ghee|ghi)\M';
  cheese := s ~ '\m(syr[a-z0-9]*|eidam[a-z0-9]*|gouda|emental[a-z0-9]*|hermelin[a-z0-9]*|niva|mozzarell[a-z0-9]*|cheddar[a-z0-9]*|parenic[a-z0-9]*|korbac[a-z0-9]*|balkansk[a-z0-9]*|cottage)\M';
  meat := s ~ '\m(maso|masov[a-z0-9]*|vepr[a-z0-9]*|hovez[a-z0-9]*|kure[a-z0-9]*|kurec[a-z0-9]*|kruti|kruta|kruty|kachn[a-z0-9]*|jehnec[a-z0-9]*|kralik[a-z0-9]*|krkovic[a-z0-9]*|kyta|plec[a-z0-9]*|kotlet[a-z0-9]*|panenk[a-z0-9]*|svickov[a-z0-9]*|rosten[a-z0-9]*|steak[a-z0-9]*|zebr[a-z0-9]*|bucek|koleno|mlete|mlety|gulasov[a-z0-9]*|jatr[a-z0-9]*|prsa|steh[a-z0-9]*|kridl[a-z0-9]*|palick[a-z0-9]*)\M';
  fruit_any := s ~ '\m(jablk[a-z0-9]*|hrusk[a-z0-9]*|banan[a-z0-9]*|pomeranc[a-z0-9]*|mandarink[a-z0-9]*|citron[a-z0-9]*|limet[a-z0-9]*|grep[a-z0-9]*|hrozn[a-z0-9]*|jahod[a-z0-9]*|malin[a-z0-9]*|boruv[a-z0-9]*|ostruzin[a-z0-9]*|rybiz[a-z0-9]*|tresn[a-z0-9]*|visn[a-z0-9]*|merunk[a-z0-9]*|broskv[a-z0-9]*|nektarink[a-z0-9]*|svestk[a-z0-9]*|mango|ananas[a-z0-9]*|avokad[a-z0-9]*|kiwi|meloun[a-z0-9]*|maraku[a-z0-9]*|papaj[a-z0-9]*)\M';
  fruit := fruit_any
    and s !~ '\m(napoj[a-z0-9]*|dzus[a-z0-9]*|juice|nektar|stava|smoothie|sirup[a-z0-9]*|syrob[a-z0-9]*|liker[a-z0-9]*|rum|vodka|gin|vino|pivo|cider|jogurt[a-z0-9]*|dezert[a-z0-9]*|tycink[a-z0-9]*|bonbon[a-z0-9]*|cokolad[a-z0-9]*|zmrzlin[a-z0-9]*|dzem[a-z0-9]*|marmelad[a-z0-9]*|kompot[a-z0-9]*|pyre|caj|susen[a-z0-9]*|lyo[a-z0-9]*|lyofiliz[a-z0-9]*|mrazen[a-z0-9]*|kandovan[a-z0-9]*|ovocn[a-z0-9]*|prichut[a-z0-9]*|zubni|pasta|tablet[a-z0-9]*|vitamin[a-z0-9]*|gummies|rasenk[a-z0-9]*|kosmetik[a-z0-9]*|prostred[a-z0-9]*|cistic[a-z0-9]*|mydlo|sampon[a-z0-9]*|aroma|vlhkost[a-z0-9]*|latex[a-z0-9]*|hrack[a-z0-9]*|halenk[a-z0-9]*|legin[a-z0-9]*|kosil[a-z0-9]*|susenk[a-z0-9]*|knedlik[a-z0-9]*|kapsick[a-z0-9]*|presnid[a-z0-9]*|svacink[a-z0-9]*|povidl[a-z0-9]*)\M';
  veg := s ~ '\m(brambor[a-z0-9]*|cibul[a-z0-9]*|cesnek[a-z0-9]*|rajcat[a-z0-9]*|paprik[a-z0-9]*|okurk[a-z0-9]*|mrkev|petrzel|celer[a-z0-9]*|kedlub[a-z0-9]*|kvetak[a-z0-9]*|brokolic[a-z0-9]*|cuket[a-z0-9]*|lilek|redkv[a-z0-9]*|repa|kapust[a-z0-9]*|zeli|salat[a-z0-9]*|spenat[a-z0-9]*|hras[a-z0-9]*|kukuric[a-z0-9]*|fazol[a-z0-9]*)\M'
    and s !~ '\m(napoj[a-z0-9]*|dzus[a-z0-9]*|stava|smoothie|pomazank[a-z0-9]*|protlak[a-z0-9]*|pyre|omack[a-z0-9]*|chips[a-z0-9]*)\M';

  if beer then tags:=array_append(tags,'beer'); end if;
  if milk then tags:=array_append(tags,'milk'); end if;
  if bread then tags:=array_append(tags,'bread'); end if;
  if s ~ '\mrohlik[a-z0-9]*\M' then tags:=array_append(tags,'rolls'); end if;
  if s ~ '\mchleb[a-z0-9]*\M' then tags:=array_append(tags,'loaf'); end if;
  if s ~ '\mbaget[a-z0-9]*\M' then tags:=array_append(tags,'baguette'); end if;
  if eggs then tags:=array_append(tags,'eggs'); end if;
  if butter then tags:=array_append(tags,'butter'); end if;
  if cheese then tags:=array_append(tags,'cheese'); end if;
  if s ~ '\meidam[a-z0-9]*\M' then tags:=array_append(tags,'eidam'); end if;
  if s ~ '\mgouda\M' then tags:=array_append(tags,'gouda'); end if;
  if meat then tags:=array_append(tags,'meat'); end if;
  if s ~ '\m(kure[a-z0-9]*|kurec[a-z0-9]*|prsa|steh[a-z0-9]*|kridl[a-z0-9]*|palick[a-z0-9]*)\M' then tags:=array_append(tags,'chicken'); end if;
  if s ~ '\mkrkovic[a-z0-9]*\M' then tags:=array_append(tags,'pork_neck'); end if;
  if s ~ '\m(vepr[a-z0-9]*|krkovic[a-z0-9]*|kyta|plec[a-z0-9]*|kotlet[a-z0-9]*|panenk[a-z0-9]*|bucek|koleno)\M' then tags:=array_append(tags,'pork'); end if;
  if s ~ '\m(hovez[a-z0-9]*|svickov[a-z0-9]*|rosten[a-z0-9]*|steak[a-z0-9]*|gulasov[a-z0-9]*)\M' then tags:=array_append(tags,'beef'); end if;
  if fruit then tags:=array_append(tags,'fruit_fresh'); end if;
  if s ~ '\mjablk[a-z0-9]*\M' then tags:=array_append(tags,'apples'); end if;
  if s ~ '\mbanan[a-z0-9]*\M' then tags:=array_append(tags,'bananas'); end if;
  if fruit_any and s ~ '\mmrazen[a-z0-9]*\M' then tags:=array_append(tags,'fruit_frozen'); end if;
  if fruit_any and s ~ '\msusen[a-z0-9]*\M' then tags:=array_append(tags,'fruit_dried'); end if;
  if s ~ '\m(ovocn[a-z0-9]*|jablk[a-z0-9]*|pomeranc[a-z0-9]*|mango|ananas[a-z0-9]*)\M'
     and s ~ '\m(napoj[a-z0-9]*|dzus[a-z0-9]*|nektar|stava|smoothie)\M' then tags:=array_append(tags,'fruit_drink'); end if;
  if veg then tags:=array_append(tags,'veg_fresh'); end if;
  if s ~ '\mbrambor[a-z0-9]*\M' then tags:=array_append(tags,'potatoes'); end if;
  if s ~ '\mrajcat[a-z0-9]*\M' then tags:=array_append(tags,'tomatoes'); end if;
  if veg and s ~ '\mmrazen[a-z0-9]*\M' then tags:=array_append(tags,'veg_frozen'); end if;
  if s ~ '\m(steril[a-z0-9]*|naklad[a-z0-9]*|konzerv[a-z0-9]*)\M'
     and s ~ '\m(zelenin[a-z0-9]*|okurk[a-z0-9]*|paprik[a-z0-9]*|hras[a-z0-9]*|kukuric[a-z0-9]*|fazol[a-z0-9]*)\M' then tags:=array_append(tags,'veg_preserved'); end if;

  return array(select distinct x from unnest(tags) x order by x);
end;
$$;

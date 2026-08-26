create or replace function public.public_offer_semantic_tags(p_search text)
returns text[]
language plpgsql
immutable parallel safe
set search_path to 'public','pg_temp'
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
  fruit_processed boolean;
  veg_any boolean;
  veg boolean;
  veg_processed boolean;
  fresh_leaf_salad boolean;
begin
  beer := s ~ '(^| )(pivo|pivni|lezak|radler|pils[a-z0-9]*|porter|stout)( |$)';

  bread := s ~ '(^| )(peciv[a-z0-9]*|chleb[a-z0-9]*|rohlik[a-z0-9]*|housk[a-z0-9]*|baget[a-z0-9]*|veka|dalam[a-z0-9]*|kaiserka|koblih[a-z0-9]*|croissant[a-z0-9]*|kolac[a-z0-9]*|buchta|zavin[a-z0-9]*|donut[a-z0-9]*|muffin[a-z0-9]*|mazanec[a-z0-9]*|loupak[a-z0-9]*)( |$)'
    and s !~ '(^| )(zavinace|forma|knedl[a-z0-9]*|bob|ryzov[a-z0-9]* chlebick[a-z0-9]*|kukuric[a-z0-9]* chlebick[a-z0-9]*|cornies|smes na|rybi salat|tunakovy salat)( |$)';

  milk := (
      s ~ '(^| )mleko( |$)'
      or s ~ '(^| )mlecny napoj( |$)'
    )
    and s !~ '(^| )(opalovan[a-z0-9]*|pletov[a-z0-9]*|telov[a-z0-9]*|hydratac[a-z0-9]*|kosmetik[a-z0-9]*|jogurt[a-z0-9]*|tvaroh[a-z0-9]*|dezert[a-z0-9]*|cokolad[a-z0-9]*|tycink[a-z0-9]*|sunar|nutrilon|kojeneck[a-z0-9]*|batolec[a-z0-9]*|horcic[a-z0-9]*)( |$)';

  eggs := s ~ '(^| )vejce( |$)'
    and s !~ '(^| )(aspik[a-z0-9]*|salat[a-z0-9]*|pomazank[a-z0-9]*)( |$)';

  butter := s ~ '(^| )(maslo|maslicko|ghee|ghi)( |$)'
    and s !~ '(^| )(telov[a-z0-9]*|pletov[a-z0-9]*|nohy|chodid[a-z0-9]*|kosmetik[a-z0-9]*|mandlov[a-z0-9]*|arasid[a-z0-9]*|orech[a-z0-9]*|pistaci[a-z0-9]*|kesu|kokosov[a-z0-9]*|semink[a-z0-9]*)( |$)';

  cheese := s ~ '(^| )(syr[a-z0-9]*|eidam[a-z0-9]*|gouda|emental[a-z0-9]*|hermelin[a-z0-9]*|niva|mozzarell[a-z0-9]*|cheddar[a-z0-9]*|parenic[a-z0-9]*|korbac[a-z0-9]*|balkansk[a-z0-9]*|cottage|camembert[a-z0-9]*|encian[a-z0-9]*)( |$)'
    and not bread
    and s !~ '(^| )(pizza|nuget[a-z0-9]*|klobas[a-z0-9]*|sekan[a-z0-9]*|parek|parky|spekack[a-z0-9]*|chips[a-z0-9]*|snack[a-z0-9]*|mrizk[a-z0-9]*|hranolk[a-z0-9]*|vitana|koreni|burger[a-z0-9]*|tortill[a-z0-9]*|wrap[a-z0-9]*)( |$)';

  prsa_meat := s ~ '(^| )prsa( |$)'
    and s !~ '(^| )(paska|podprsenk[a-z0-9]*|nalepk[a-z0-9]*|ochran[a-z0-9]*|bradavk[a-z0-9]*|kosmetik[a-z0-9]*|odev[a-z0-9]*|trick[a-z0-9]*|top|plavk[a-z0-9]*)( |$)';

  pet_context := s ~ '(^| )(akinu|dingo|dog snaq|prevital|vetamix|vitakraft|shinycat|huhubamboo|propesko|felix fantastic|whiskas|pedigree|purina|darling|rewards)( |$)'
    or s ~ '(^| )(pro psy|pro kocky|pro psa|granule|pamlsk[a-z0-9]*|krmivo|kapsicky pro)( |$)';
  meat_alternative := s ~ '(^| )(alternativ[a-z0-9]*|vegetari[a-z0-9]*|vegansk[a-z0-9]*|rostlinn[a-z0-9]*|veggie)( |$)';
  seasoning_context := s ~ '(^| )(vitana|maggi|knorr)( |$)';

  processed_meat := s ~ '(^| )(pastik[a-z0-9]*|pate|krem[a-z0-9]*|pomazank[a-z0-9]*|parek|parky|pareck[a-z0-9]*|klobas[a-z0-9]*|sunk[a-z0-9]*|tlacenk[a-z0-9]*|luncheon[a-z0-9]*|konzerv[a-z0-9]*|sadlo|skvark[a-z0-9]*|nuget[a-z0-9]*|strips[a-z0-9]*|spiz[a-z0-9]*|cevap[a-z0-9]*|burger[a-z0-9]*|instant[a-z0-9]*|nudle|nudlov[a-z0-9]*|prichut[a-z0-9]*|polevk[a-z0-9]*|vyvar[a-z0-9]*|omack[a-z0-9]*|koreni|bujon[a-z0-9]*|hotov[a-z0-9]*|susene|suseny|susena|uzenin[a-z0-9]*|uzene|uzeny|uzena|rolk[a-z0-9]*|grilset[a-z0-9]*|knedl[a-z0-9]*|holandsk[a-z0-9]*|trhan[a-z0-9]*|gulas)( |$)'
    or s ~ '(^| )(pecene|peceny|pecena) (kure|maso|veprove|hovezi)( |$)'
    or s ~ '(^| )sous vide( |$)';

  meat_species := s ~ '(^| )(vepr[a-z0-9]*|hovez[a-z0-9]*|kure|kurec[a-z0-9]*|kruti|kruta|kruty|kachn[a-z0-9]*|jehnec[a-z0-9]*|kralic[a-z0-9]*|angus)( |$)';

  meat_cut := s ~ '(^| )(krkovic[a-z0-9]*|kyta|plec|kotlet[a-z0-9]*|panenk[a-z0-9]*|svickov[a-z0-9]*|rosten[a-z0-9]*|hrudi|zebir[a-z0-9]*|zebro|zeber|bucek|koleno|jatr[a-z0-9]*|eyeround|sirloin|ribeye|flank|brisket|ribs)( |$)'
    or (meat_species and (prsa_meat or s ~ '(^| )(steh[a-z0-9]*|kridl[a-z0-9]*|nudlick[a-z0-9]*|steak[a-z0-9]*|filet[a-z0-9]*|rizek|rizky|mlete|mlety|mleta|melnene|melneneho|bok|licka)( |$)'))
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

  if meat then
    milk := false;
    eggs := false;
    butter := false;
    cheese := false;
  end if;

  fruit_any := s ~ '(^| )(jablk[a-z0-9]*|hrusk[a-z0-9]*|banan[a-z0-9]*|pomeranc[a-z0-9]*|mandarink[a-z0-9]*|citron[a-z0-9]*|limet[a-z0-9]*|grep[a-z0-9]*|hrozn[a-z0-9]*|jahod[a-z0-9]*|malin[a-z0-9]*|boruv[a-z0-9]*|ostruzin[a-z0-9]*|rybiz[a-z0-9]*|tresn[a-z0-9]*|visn[a-z0-9]*|merunk[a-z0-9]*|broskv[a-z0-9]*|nektarink[a-z0-9]*|svestk[a-z0-9]*|mango|ananas[a-z0-9]*|avokad[a-z0-9]*|kiwi|meloun[a-z0-9]*|maraku[a-z0-9]*|papaj[a-z0-9]*)( |$)';

  fruit_processed := bread or meat_context
    or s ~ '(^| )(zakys[a-z0-9]*|jogurt[a-z0-9]*|jogobella|termix|kase|ovesn[a-z0-9]*|ryze|oplatk[a-z0-9]*|rezy|rez[a-z0-9]*|krekry|krupk[a-z0-9]*|tycink[a-z0-9]*|bonbon[a-z0-9]*|cokolad[a-z0-9]*|dezert[a-z0-9]*|zmrzlin[a-z0-9]*|dzem[a-z0-9]*|marmelad[a-z0-9]*|kompot[a-z0-9]*|pyre|prikrm[a-z0-9]*|presnid[a-z0-9]*|snack[a-z0-9]*|susen[a-z0-9]*|lyo[a-z0-9]*|lyofiliz[a-z0-9]*|mrazen[a-z0-9]*|kandovan[a-z0-9]*|loupan[a-z0-9]*|pulen[a-z0-9]*|napln[a-z0-9]*|prichut[a-z0-9]*|horcic[a-z0-9]*|salat[a-z0-9]*|orisk[a-z0-9]*|raw star|santee)( |$)'
    or s ~ '(^| )(napoj[a-z0-9]*|drink|dzus[a-z0-9]*|juice|nektar|stava|smoothie|sirup[a-z0-9]*|voda|mineral[a-z0-9]*|birell|mattoni|sodastream|liker[a-z0-9]*|rum|vodka|gin|vino|pivo|cider|destilat[a-z0-9]*|slivovic[a-z0-9]*|moravska svestka)( |$)'
    or s ~ '(^| )(maska|peeling|kosmetik[a-z0-9]*|pletov[a-z0-9]*|telov[a-z0-9]*|sprchov[a-z0-9]*|sampon[a-z0-9]*|gel|vuni|rty|textiln[a-z0-9]*|praci|jidlono[a-z0-9]*|sedaci|trick[a-z0-9]*|zaves|kvetina|latka|barva)( |$)'
    or s ~ '(^| )(strepsils|pastilk[a-z0-9]*|tablet[a-z0-9]*|vitamin[a-z0-9]*|electrolyte)( |$)';

  fruit := fruit_any and not fruit_processed;

  fresh_leaf_salad := s ~ '(^| )(salat little gem|hlavkovy salat|ledovy salat|rimsky salat|salat lollo|polnicek)( |$)';
  veg_any := s ~ '(^| )(brambor[a-z0-9]*|batat[a-z0-9]*|cibul[a-z0-9]*|cesnek[a-z0-9]*|rajcat[a-z0-9]*|paprik[a-z0-9]*|okurk[a-z0-9]*|mrkev|petrzel|celer[a-z0-9]*|kedlub[a-z0-9]*|kvetak[a-z0-9]*|brokolic[a-z0-9]*|cuket[a-z0-9]*|lilek|redkv[a-z0-9]*|repa|kapust[a-z0-9]*|zeli|spenat[a-z0-9]*|kukuric[a-z0-9]*)( |$)'
    or fresh_leaf_salad;

  veg_processed := bread or meat_context
    or (s ~ '(^| )salat[a-z0-9]*( |$)' and not fresh_leaf_salad)
    or s ~ '(^| )(kysan[a-z0-9]*|naklad[a-z0-9]*|nalev[a-z0-9]*|sladkokys[a-z0-9]*|steril[a-z0-9]*|konzerv[a-z0-9]*|vapeur|bonduelle|giana|znojmia)( |$)'
    or s ~ '(^| )(snack[a-z0-9]*|chips[a-z0-9]*|bramburk[a-z0-9]*|krekry|krupk[a-z0-9]*|chlebick[a-z0-9]*|cornies|halusk[a-z0-9]*|tortell[a-z0-9]*|pizza|fusilli|testovin[a-z0-9]*|dressing[a-z0-9]*|hummus|americke brambory|pecene brambory|restovan[a-z0-9]* cibul[a-z0-9]*|bulka|rybi|matjes[a-z0-9]*|makrela|losos|syr[a-z0-9]*|vitana|lis na|tablet[a-z0-9]*|umel[a-z0-9]* kvetina)( |$)';

  veg := veg_any and not veg_processed;

  if beer then tags:=array_append(tags,'beer'); end if;
  if milk then tags:=array_append(tags,'milk'); end if;
  if bread then tags:=array_append(tags,'bread'); end if;
  if bread and s ~ '(^| )rohlik[a-z0-9]*( |$)' then tags:=array_append(tags,'rolls'); end if;
  if bread and s ~ '(^| )chleb[a-z0-9]*( |$)' then tags:=array_append(tags,'loaf'); end if;
  if bread and s ~ '(^| )baget[a-z0-9]*( |$)' then tags:=array_append(tags,'baguette'); end if;
  if eggs then tags:=array_append(tags,'eggs'); end if;
  if butter then tags:=array_append(tags,'butter'); end if;
  if cheese then tags:=array_append(tags,'cheese'); end if;
  if cheese and s ~ '(^| )eidam[a-z0-9]*( |$)' then tags:=array_append(tags,'eidam'); end if;
  if cheese and s ~ '(^| )gouda( |$)' then tags:=array_append(tags,'gouda'); end if;
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
  if not meat_context
     and s ~ '(^| )(ovocn[a-z0-9]*|jablk[a-z0-9]*|pomeranc[a-z0-9]*|mango|ananas[a-z0-9]*)( |$)'
     and s ~ '(^| )(napoj[a-z0-9]*|dzus[a-z0-9]*|nektar|stava|smoothie)( |$)'
  then tags:=array_append(tags,'fruit_drink'); end if;

  if veg then tags:=array_append(tags,'veg_fresh'); end if;
  if veg and s ~ '(^| )brambor[a-z0-9]*( |$)' then tags:=array_append(tags,'potatoes'); end if;
  if veg and s ~ '(^| )rajcat[a-z0-9]*( |$)' then tags:=array_append(tags,'tomatoes'); end if;
  if veg_any and not meat_context and s ~ '(^| )mrazen[a-z0-9]*( |$)' then tags:=array_append(tags,'veg_frozen'); end if;
  if veg_any and not meat_context
     and s ~ '(^| )(steril[a-z0-9]*|naklad[a-z0-9]*|konzerv[a-z0-9]*|nalev[a-z0-9]*|kysan[a-z0-9]*|sladkokys[a-z0-9]*)( |$)'
  then tags:=array_append(tags,'veg_preserved'); end if;

  return array(select distinct x from unnest(tags) x order by x);
end;
$$;

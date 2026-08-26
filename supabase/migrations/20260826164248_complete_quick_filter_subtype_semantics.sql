set local statement_timeout = '90s';

do $migration$
declare
  d text;
  needle text;
  repl text;
begin
  d := pg_get_functiondef('public.public_offer_semantic_tags(text)'::regprocedure);

  needle := $n$  if beer then tags:=array_append(tags,'beer'); end if;$n$;
  if position(needle in d)=0 then raise exception 'beer append point not found'; end if;
  repl := $r$  if beer then tags:=array_append(tags,'beer'); end if;
  if beer and s ~ '(^| )lezak[a-z0-9]*( |$)' then tags:=array_append(tags,'beer_lager'); end if;
  if beer and s ~ '(^| )vycepn[a-z0-9]*( |$)' then tags:=array_append(tags,'beer_draught'); end if;
  if beer and s ~ '(^| )(nealko|nealkoholick[a-z0-9]*|birell)( |$)' then tags:=array_append(tags,'beer_nonalc'); end if;
  if beer and s ~ '(^| )radler[a-z0-9]*( |$)' then tags:=array_append(tags,'beer_radler'); end if;
  if beer and s ~ '(^| )(plech|plechovk[a-z0-9]*|plechov[a-z0-9]*)( |$)' then tags:=array_append(tags,'beer_can'); end if;
  if beer and s ~ '(^| )(lahev|lahvov[a-z0-9]*)( |$)' then tags:=array_append(tags,'beer_bottle'); end if;
  if beer and (s ~ '(^| )(multipack|baleni)( |$)' or s ~ '(^| )[2-9][0-9]*x[0-9]+( |$)') then tags:=array_append(tags,'beer_multipack'); end if;$r$;
  d := replace(d, needle, repl);

  needle := $n$  if milk then tags:=array_append(tags,'milk'); end if;$n$;
  if position(needle in d)=0 then raise exception 'milk append point not found'; end if;
  repl := $r$  if milk then tags:=array_append(tags,'milk'); end if;
  if milk and (s ~ '(^| )plnotucn[a-z0-9]*( |$)' or s ~ '(^| )3 5( |$)') then tags:=array_append(tags,'milk_fullfat'); end if;
  if milk and (s ~ '(^| )polotucn[a-z0-9]*( |$)' or s ~ '(^| )1 5( |$)') then tags:=array_append(tags,'milk_semiskim'); end if;
  if milk and s ~ '(^| )(bezlaktoz[a-z0-9]*|bez laktozy)( |$)' then tags:=array_append(tags,'milk_lactosefree'); end if;
  if milk and s ~ '(^| )(cerstv[a-z0-9]*|farmarsk[a-z0-9]*)( |$)' then tags:=array_append(tags,'milk_fresh'); end if;
  if milk and s ~ '(^| )(trvanliv[a-z0-9]*|tvanliv[a-z0-9]*|uht)( |$)' then tags:=array_append(tags,'milk_uht'); end if;
  if milk and s ~ '(^| )(kondenzovan[a-z0-9]*|salko)( |$)' then tags:=array_append(tags,'milk_condensed'); end if;
  if ((s ~ '(^| )(rostlinn[a-z0-9]*|ovesn[a-z0-9]*|mandlov[a-z0-9]*|sojov[a-z0-9]*|kokosov[a-z0-9]*|ryzov[a-z0-9]*)( |$)' and s ~ '(^| )napoj[a-z0-9]*( |$)') or (s ~ '(^| )alpro( |$)' and s ~ '(^| )(ovesn[a-z0-9]*|mandlov[a-z0-9]*|sojov[a-z0-9]*|kokosov[a-z0-9]*)( |$)')) then tags:=array_append(tags,'plant_drink'); end if;$r$;
  d := replace(d, needle, repl);

  needle := $n$  if eggs then tags:=array_append(tags,'eggs'); end if;$n$;
  if position(needle in d)=0 then raise exception 'eggs append point not found'; end if;
  repl := $r$  if eggs then tags:=array_append(tags,'eggs'); end if;
  if eggs and s !~ '(^| )krepelc[a-z0-9]*( |$)' then tags:=array_append(tags,'eggs_chicken'); end if;
  if eggs and s ~ '(^| )krepelc[a-z0-9]*( |$)' then tags:=array_append(tags,'eggs_quail'); end if;
  if eggs and s ~ '(^| )m( |$)' then tags:=array_append(tags,'eggs_m'); end if;
  if eggs and s ~ '(^| )l( |$)' then tags:=array_append(tags,'eggs_l'); end if;
  if eggs and s ~ '(^| )(volny vybeh|volneho vybehu)( |$)' then tags:=array_append(tags,'eggs_free_range'); end if;
  if eggs and s ~ '(^| )podestylk[a-z0-9]*( |$)' then tags:=array_append(tags,'eggs_barn'); end if;
  if eggs and s ~ '(^| )bio( |$)' then tags:=array_append(tags,'eggs_bio'); end if;$r$;
  d := replace(d, needle, repl);

  needle := $n$  if butter then tags:=array_append(tags,'butter'); end if;$n$;
  if position(needle in d)=0 then raise exception 'butter append point not found'; end if;
  repl := $r$  if butter then tags:=array_append(tags,'butter'); end if;
  if butter and s ~ '(^| )(ghee|ghi|prepusten[a-z0-9]*)( |$)' then tags:=array_append(tags,'butter_ghee'); end if;
  if butter and s ~ '(^| )(solen[a-z0-9]*|slan[a-z0-9]*)( |$)' then tags:=array_append(tags,'butter_salted'); end if;
  if butter and s ~ '(^| )(ochucen[a-z0-9]*|bylink[a-z0-9]*|cesnek[a-z0-9]*|chilli)( |$)' then tags:=array_append(tags,'butter_flavoured'); end if;
  if butter and s !~ '(^| )(ghee|ghi|prepusten[a-z0-9]*|solen[a-z0-9]*|slan[a-z0-9]*|ochucen[a-z0-9]*|bylink[a-z0-9]*|cesnek[a-z0-9]*|chilli)( |$)' then tags:=array_append(tags,'butter_classic'); end if;
  if butter and (s ~ '(^| )kostk[a-z0-9]*( |$)' or s ~ '(^| )(200|250) g( |$)') and s !~ '(^| )(kelimek|vanick[a-z0-9]*|roztirateln[a-z0-9]*)( |$)' then tags:=array_append(tags,'butter_block'); end if;
  if butter and s ~ '(^| )(kelimek|vanick[a-z0-9]*)( |$)' then tags:=array_append(tags,'butter_tub'); end if;$r$;
  d := replace(d, needle, repl);

  needle := $n$  if cheese then tags:=array_append(tags,'cheese'); end if;$n$;
  if position(needle in d)=0 then raise exception 'cheese append point not found'; end if;
  repl := $r$  if cheese then tags:=array_append(tags,'cheese'); end if;
  if cheese and s ~ '(^| )hermelin[a-z0-9]*( |$)' then tags:=array_append(tags,'cheese_hermelin'); end if;
  if cheese and s ~ '(^| )mozzarell[a-z0-9]*( |$)' then tags:=array_append(tags,'cheese_mozzarella'); end if;
  if cheese and s ~ '(^| )taven[a-z0-9]*( |$)' then tags:=array_append(tags,'cheese_processed'); end if;
  if cheese and s ~ '(^| )(tvrdy|tvrde|polotvrdy|polotvrde|eidam[a-z0-9]*|gouda|emental[a-z0-9]*|cheddar[a-z0-9]*|grana|parmezan[a-z0-9]*)( |$)' then tags:=array_append(tags,'cheese_hard'); end if;
  if cheese and s ~ '(^| )(mekky|mekke|hermelin[a-z0-9]*|mozzarell[a-z0-9]*|camembert[a-z0-9]*|encian[a-z0-9]*|niva|cottage)( |$)' then tags:=array_append(tags,'cheese_soft'); end if;
  if cheese and s ~ '(^| )platk[a-z0-9]*( |$)' then tags:=array_append(tags,'cheese_sliced'); end if;
  if cheese and s ~ '(^| )strouhan[a-z0-9]*( |$)' then tags:=array_append(tags,'cheese_grated'); end if;$r$;
  d := replace(d, needle, repl);

  needle := $n$  if meat and s ~ '(^| )(hovez[a-z0-9]*|angus|eyeround|sirloin|ribeye|rosten[a-z0-9]*)( |$)' then tags:=array_append(tags,'beef'); end if;$n$;
  if position(needle in d)=0 then raise exception 'meat append point not found'; end if;
  repl := $r$  if meat and s ~ '(^| )(hovez[a-z0-9]*|angus|eyeround|sirloin|ribeye|rosten[a-z0-9]*)( |$)' then tags:=array_append(tags,'beef'); end if;
  if meat and s ~ '(^| )(kruti|kruta|kruty|krut[a-z0-9]*)( |$)' then tags:=array_append(tags,'turkey'); end if;
  if meat and s ~ '(^| )(mlete|mlety|mleta|melnene|melneneho)( |$)' then tags:=array_append(tags,'minced_meat'); end if;
  if meat and s !~ '(^| )mrazen[a-z0-9]*( |$)' then tags:=array_append(tags,'meat_fresh'); end if;
  if meat and s ~ '(^| )mrazen[a-z0-9]*( |$)' then tags:=array_append(tags,'meat_frozen'); end if;
  if meat and s ~ '(^| )(marinad[a-z0-9]*|marinovan[a-z0-9]*|nalozen[a-z0-9]*)( |$)' then tags:=array_append(tags,'marinated_meat'); end if;
  if not pet_context and not seasoning_context
     and s ~ '(^| )(losos[a-z0-9]*|tres[a-z0-9]*|tunak[a-z0-9]*|kapr[a-z0-9]*|pstruh[a-z0-9]*|makrel[a-z0-9]*|pangasi[a-z0-9]*|sled[a-z0-9]*|prazm[a-z0-9]*|tilapi[a-z0-9]*|candat[a-z0-9]*|sumec[a-z0-9]*)( |$)'
     and s !~ '(^| )(salat[a-z0-9]*|pomazank[a-z0-9]*|pizza|sushi|polevk[a-z0-9]*|omack[a-z0-9]*|prichut[a-z0-9]*)( |$)'
  then tags:=array_append(tags,'fish'); end if;
  if not pet_context and not seasoning_context
     and s ~ '(^| )(sunk[a-z0-9]*|salam[a-z0-9]*|parek|parky|pareck[a-z0-9]*|klobas[a-z0-9]*|slanina|spekack[a-z0-9]*|tlacenk[a-z0-9]*|uzenin[a-z0-9]*|luncheon[a-z0-9]*)( |$)'
  then tags:=array_append(tags,'cold_cuts'); end if;$r$;
  d := replace(d, needle, repl);

  needle := $n$  fruit_processed := bread or meat_context$n$;
  if position(needle in d)=0 then raise exception 'fruit processed point not found'; end if;
  repl := $r$  fruit_processed := bread or meat_context
    or s ~ '(^| )(caj|tea|nealko|nealkoholick[a-z0-9]*)( |$)'
    or (fruit_any and s ~ '(^| )[0-9]+( [0-9]+)? l( |$)')$r$;
  d := replace(d, needle, repl);

  needle := $n$  if fruit and s ~ '(^| )banan[a-z0-9]*( |$)' then tags:=array_append(tags,'bananas'); end if;$n$;
  if position(needle in d)=0 then raise exception 'fruit subtype point not found'; end if;
  repl := $r$  if fruit and s ~ '(^| )banan[a-z0-9]*( |$)' then tags:=array_append(tags,'bananas'); end if;
  if fruit and s ~ '(^| )(pomeranc[a-z0-9]*|mandarink[a-z0-9]*|citron[a-z0-9]*|limet[a-z0-9]*|grep[a-z0-9]*)( |$)' then tags:=array_append(tags,'fruit_citrus'); end if;
  if fruit and s ~ '(^| )(jahod[a-z0-9]*|malin[a-z0-9]*|boruv[a-z0-9]*|ostruzin[a-z0-9]*|rybiz[a-z0-9]*)( |$)' then tags:=array_append(tags,'fruit_berries'); end if;
  if fruit and s ~ '(^| )(mango|ananas[a-z0-9]*|avokad[a-z0-9]*|kiwi|meloun[a-z0-9]*|maraku[a-z0-9]*|papaj[a-z0-9]*)( |$)' then tags:=array_append(tags,'fruit_exotic'); end if;$r$;
  d := replace(d, needle, repl);

  needle := $n$  if fruit_any and not meat_context and s ~ '(^| )mrazen[a-z0-9]*( |$)' then tags:=array_append(tags,'fruit_frozen'); end if;$n$;
  if position(needle in d)=0 then raise exception 'fruit frozen point not found'; end if;
  repl := $r$  if fruit_any and not meat_context and s ~ '(^| )mrazen[a-z0-9]*( |$)'
     and s !~ '(^| )(cokolad[a-z0-9]*|jogurt[a-z0-9]*|dezert[a-z0-9]*|zmrzlin[a-z0-9]*|tycink[a-z0-9]*|oplatk[a-z0-9]*|susenk[a-z0-9]*)( |$)'
  then tags:=array_append(tags,'fruit_frozen'); end if;$r$;
  d := replace(d, needle, repl);

  needle := $n$  if fruit_any and not meat_context and s ~ '(^| )susen[a-z0-9]*( |$)' then tags:=array_append(tags,'fruit_dried'); end if;$n$;
  if position(needle in d)=0 then raise exception 'fruit dried point not found'; end if;
  repl := $r$  if fruit_any and not meat_context and s ~ '(^| )susen[a-z0-9]*( |$)'
     and s !~ '(^| )(cokolad[a-z0-9]*|jogurt[a-z0-9]*|tycink[a-z0-9]*|oplatk[a-z0-9]*|susenk[a-z0-9]*|musli|granola|kase)( |$)'
  then tags:=array_append(tags,'fruit_dried'); end if;$r$;
  d := replace(d, needle, repl);

  needle := $n$     and s ~ '(^| )(napoj[a-z0-9]*|dzus[a-z0-9]*|nektar|stava|smoothie)( |$)'
  then tags:=array_append(tags,'fruit_drink'); end if;$n$;
  if position(needle in d)=0 then raise exception 'fruit drink point not found'; end if;
  repl := $r$     and s ~ '(^| )(napoj[a-z0-9]*|dzus[a-z0-9]*|nektar|stava|smoothie)( |$)'
     and s !~ '(^| )(jogurt[a-z0-9]*|kefir[a-z0-9]*|mlecn[a-z0-9]*|mleko|activia|pilos)( |$)'
  then tags:=array_append(tags,'fruit_drink'); end if;$r$;
  d := replace(d, needle, repl);

  execute d;
end;
$migration$;

select private.refresh_public_offer_search_cache_if_dirty(true);

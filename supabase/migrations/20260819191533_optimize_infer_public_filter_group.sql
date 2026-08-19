create or replace function public.infer_public_filter_group(p_name text, p_category_slug text default null)
returns text
language plpgsql
immutable
parallel safe
set search_path = public, pg_temp
as $$
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
    else 'other'
  end;
end;
$$;

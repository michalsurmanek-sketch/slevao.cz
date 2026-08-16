create or replace function public.preview_product_taxonomy(p_product_id uuid)
returns table(category_slug text, filter_group text, filter_tags text[], confidence numeric, source text)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_text text;
  v_stores text[];
  v_is_pharmacy boolean;
  v_is_drugstore boolean;
begin
  select
    ' ' || trim(regexp_replace(
      lower(public.unaccent(coalesce(p.name,'') || ' ' || coalesce(p.brand,''))),
      '[^a-z0-9]+',' ','g'
    )) || ' ',
    array_remove(array_agg(distinct s.slug), null)
  into v_text, v_stores
  from public.products p
  left join public.offers o on o.product_id = p.id
  left join public.stores s on s.id = o.store_id
  where p.id = p_product_id
  group by p.id,p.name,p.brand;
  if v_text is null then return; end if;
  v_is_pharmacy := coalesce(v_stores && array['benu','dr-max','pilulka']::text[], false);
  v_is_drugstore := coalesce(v_stores && array['dm','rossmann','teta']::text[], false);
  if coalesce(v_stores && array['ca','cropp','house','reserved','takko']::text[], false) then
    return query select 'moda','fashion',array['moda']::text[],0.99::numeric,'store-segment-v2'; return;
  elsif v_text ~ ' (sampon|mydlo|sprchovy|deodorant|zubni|kartacek|praci|avivaz|cistic|toaletni|plenky|kosmetika|ustni voda) ' then
    return query select 'drogerie','drugstore',array['drogerie']::text[],0.98::numeric,'name-token-v2'; return;
  elsif not v_is_pharmacy and v_text ~ ' (telefon|smartphone|notebook|televize|sluchatka|pocitac|monitor|usb|hdmi) ' then
    return query select 'elektronika','electronics',array['elektronika']::text[],0.98::numeric,'name-token-v2'; return;
  elsif v_text ~ ' (pivo|lezak|radler|cola|limonada|limonady|mineralka|mineralni|dzus|juice|sirup|energy|tonic|kava|caj|vino|voda|napoj|napoje|kombucha) ' then
    return query select 'napoje','drinks',array['napoje']::text[],0.97::numeric,'name-token-v2'; return;
  elsif v_text ~ ' (veprove|veprova|veprovy|hovezi|kureci|kure|kruti|kachni|jehneci|krkovice|kyta|plec|kotleta|panenka|svickova|rostenka|steak|bucek|koleno|mlete|sunka|slanina|salam|klobasa|parek|uzeny|uzenina|losos|treska|tunak|kapr|pstruh|makrela) ' then
    return query select 'maso-ryby','food',array['maso']::text[],0.97::numeric,'name-token-v2'; return;
  elsif v_text ~ ' (mleko|jogurt|eidam|gouda|emental|hermelin|niva|mozzarella|cheddar|cottage|maslo|smetana|tvaroh|kefir) ' then
    return query select 'mlecne-vyrobky','food',array['mlecne']::text[],0.97::numeric,'name-token-v2'; return;
  elsif v_text ~ ' (chleb|rohlik|rohliky|houska|housky|bageta|bagety|veka|kaiserka|toastovy|kobliha|croissant|kolac) ' and v_text !~ ' rohlik cz ' then
    return query select 'pecivo','food',array['pecivo']::text[],0.97::numeric,'name-token-v2'; return;
  elsif v_text ~ ' (cokolada|bonbony|susenk|susenky|oplatky|pralinky|lentilky|karamelky|zvykacky) ' or (v_text ~ ' tycinka ' and not v_is_drugstore and not v_is_pharmacy) then
    return query select 'sladkosti','food',array['sladkosti']::text[],0.97::numeric,'name-token-v2'; return;
  elsif v_text ~ ' (tricko|kalhoty|bunda|boty|ponozky|mikina|saty|sukne|kosile) ' then
    return query select 'moda','fashion',array['moda']::text[],0.97::numeric,'name-token-v2'; return;
  elsif v_text ~ ' (pneumatika|pneumatiky|motorovy|sterac|sterace|autobaterie) ' then
    return query select 'auto','auto',array['auto']::text[],0.97::numeric,'name-token-v2'; return;
  elsif v_text ~ ' (jablko|jablka|hruska|hrusky|banan|banany|pomeranc|pomerance|mandarinka|citron|citrony|hrozny|jahody|maliny|boruvky|tresne|merunky|broskve|svestky|mango|ananas|avokado|kiwi|meloun|brambory|cibule|cesnek|rajcata|paprika|papriky|okurka|okurky|mrkev|celer|kvetak|brokolice|cuketa|redkvicky|repa|zeli|salat|spenat) ' and v_text !~ ' (chips|prichut|liker|rumovy|ovocne|chlebicky|pochoutkovy|susene|smoothie|dzus|juice|napoj|nektar) ' then
    return query select 'ovoce-zelenina','food',array['ovoce-zelenina']::text[],0.97::numeric,'name-token-v2'; return;
  elsif v_text ~ ' (mouka|cukr|ryze|testoviny|ocet|lusteniny|koreni) ' and v_text !~ ' (pivo|lezak|radler) ' then
    return query select 'trvanlive-potraviny','food',array['trvanlive']::text[],0.96::numeric,'name-token-v2'; return;
  end if;
end;
$$;
revoke all on function public.preview_product_taxonomy(uuid) from public;
grant execute on function public.preview_product_taxonomy(uuid) to anon, authenticated, service_role;
comment on function public.preview_product_taxonomy(uuid) is 'Read-only taxonomy classifier preview v2 with retailer/context exclusions. Does not mutate products or offers; use for QA before backfill.';
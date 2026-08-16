create or replace function public.preview_product_taxonomy(p_product_id uuid)
returns table(category_slug text, filter_group text, filter_tags text[], confidence numeric, source text)
language sql
stable
security invoker
set search_path = public
as $$
  with src as (
    select
      p.id,
      ' ' || trim(regexp_replace(
        lower(public.unaccent(coalesce(p.name,'') || ' ' || coalesce(p.brand,''))),
        '[^a-z0-9]+',' ','g'
      )) || ' ' as t,
      array_remove(array_agg(distinct s.slug), null) as store_slugs
    from public.products p
    left join public.offers o on o.product_id = p.id
    left join public.stores s on s.id = o.store_id
    where p.id = p_product_id
    group by p.id,p.name,p.brand
  ), predicted as (
    select case
      when store_slugs && array['ca','cropp','house','reserved','sinsay','takko']::text[]
        then row('moda','fashion',array['moda']::text[],0.99::numeric,'store-segment-v1')
      when t ~ ' (pivo|lezak|radler|cola|limonada|limonady|mineralka|mineralni|dzus|juice|sirup|energy|tonic|kava|caj|vino|voda|napoj|napoje) '
        then row('napoje','drinks',array['napoje']::text[],0.97::numeric,'name-token-v1')
      when t ~ ' (veprove|veprova|veprovy|hovezi|kureci|kure|kruti|kachni|jehneci|krkovice|kyta|plec|kotleta|panenka|svickova|rostenka|steak|bucek|koleno|mlete|sunka|slanina|salam|klobasa|parek|uzeny|uzenina|losos|treska|tunak|kapr|pstruh|makrela) '
        then row('maso-ryby','food',array['maso']::text[],0.97::numeric,'name-token-v1')
      when t ~ ' (mleko|jogurt|eidam|gouda|emental|hermelin|niva|mozzarella|cheddar|cottage|maslo|smetana|tvaroh|kefir) '
        then row('mlecne-vyrobky','food',array['mlecne']::text[],0.97::numeric,'name-token-v1')
      when t ~ ' (chleb|rohlik|rohliky|houska|housky|bageta|bagety|veka|kaiserka|toastovy|kobliha|croissant|kolac) '
        then row('pecivo','food',array['pecivo']::text[],0.97::numeric,'name-token-v1')
      when t ~ ' (cokolada|bonbony|susenk|susenky|oplatky|tycinka|pralinky|lentilky|karamelky|zvykacky) '
        then row('sladkosti','food',array['sladkosti']::text[],0.97::numeric,'name-token-v1')
      when t ~ ' (sampon|mydlo|sprchovy|deodorant|zubni|kartacek|praci|avivaz|cistic|toaletni|plenky|kosmetika) '
        then row('drogerie','drugstore',array['drogerie']::text[],0.97::numeric,'name-token-v1')
      when t ~ ' (telefon|smartphone|notebook|televize|sluchatka|pocitac|tablet|monitor|usb|hdmi) '
        then row('elektronika','electronics',array['elektronika']::text[],0.97::numeric,'name-token-v1')
      when t ~ ' (tricko|kalhoty|bunda|boty|ponozky|mikina|saty|sukne|kosile) '
        then row('moda','fashion',array['moda']::text[],0.97::numeric,'name-token-v1')
      when t ~ ' (pneumatika|pneumatiky|motorovy|sterac|sterace|autobaterie) '
        then row('auto','auto',array['auto']::text[],0.97::numeric,'name-token-v1')
      when t ~ ' (jablko|jablka|hruska|hrusky|banan|banany|pomeranc|pomerance|mandarinka|citron|citrony|hrozny|jahody|maliny|boruvky|tresne|merunky|broskve|svestky|mango|ananas|avokado|kiwi|meloun|brambory|cibule|cesnek|rajcata|paprika|papriky|okurka|okurky|mrkev|celer|kvetak|brokolice|cuketa|redkvicky|repa|zeli|salat|spenat) '
        then row('ovoce-zelenina','food',array['ovoce-zelenina']::text[],0.96::numeric,'name-token-v1')
      when t ~ ' (mouka|cukr|ryze|testoviny|ocet|lusteniny|koreni) '
        then row('trvanlive-potraviny','food',array['trvanlive']::text[],0.96::numeric,'name-token-v1')
      else null end as r
    from src
  )
  select (r).f1::text,(r).f2::text,(r).f3::text[],(r).f4::numeric,(r).f5::text
  from predicted where r is not null;
$$;

revoke all on function public.preview_product_taxonomy(uuid) from public;
grant execute on function public.preview_product_taxonomy(uuid) to anon, authenticated, service_role;

comment on function public.preview_product_taxonomy(uuid) is
  'Read-only taxonomy classifier preview. Does not mutate products or offers; use for QA before backfill.';
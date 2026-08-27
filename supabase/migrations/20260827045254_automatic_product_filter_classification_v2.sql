create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable
parallel safe
as $$ select 2; $$;

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
as $$
declare
  v_category_slug text;
  v_group text := 'other';
  v_tags text[] := '{}'::text[];
  v_search text := concat_ws(' ',coalesce(p_name,''),coalesce(p_quantity_text,''));
  n text := public.normalize_text(v_search);
begin
  if p_category_id is not null then
    select c.slug into v_category_slug from public.categories c where c.id=p_category_id;
    v_group := public.infer_public_filter_group(p_name,v_category_slug);
    if v_group <> 'other' then return v_group; end if;
  end if;

  if n ~ '(^| )(sampon[a-z0-9]*|mydlo|deodorant[a-z0-9]*|antiperspirant[a-z0-9]*|sprchov[a-z0-9]*|pletov[a-z0-9]*|telov[a-z0-9]*|micelarni|odlicovac[a-z0-9]*|kosmetik[a-z0-9]*|cistic[a-z0-9]*|cistici[a-z0-9]*|praci|avivaz[a-z0-9]*|wc blok|wc gel|prostredek na nadobi|tablety do mycky|pleny|vlhcene ubrousky)( |$)' then
    return 'drugstore';
  end if;
  if n ~ '(^| )(krmivo|granule|stelivo|pro psy|pro psa|pro kocky|pamlsk[a-z0-9]*|kapsicky pro psy|kapsicky pro kocky|konzerva pro psy|konzerva pro kocky|whiskas|pedigree|purina|vetamix)( |$)' then
    return 'pets';
  end if;
  if n ~ '(^| )(mikina|teplaky|bunda|halenka|kosile|sukne|tilko|vesta|boxerky|kalhoty|dziny|bluza|tricko|saty|sortky|ponozky|leginy|svetr|kabat)( |$)' then
    return 'fashion';
  end if;

  v_tags := public.public_offer_semantic_tags(v_search);

  if v_tags && array['beer','beer_lager','beer_draught','beer_nonalc','beer_radler','fruit_drink','plant_drink']::text[] then
    return 'drinks';
  end if;

  if v_tags && array[
    'milk','bread','buns','sweet_bakery','bread_fresh','bread_packaged','bread_gluten_free','rolls','loaf','baguette',
    'eggs','butter','cheese','eidam','gouda','meat','chicken','pork_neck','pork','beef','turkey','minced_meat','meat_fresh','meat_frozen','marinated_meat',
    'fish','cold_cuts','fruit_fresh','apples','bananas','fruit_citrus','fruit_berries','fruit_exotic','fruit_frozen','fruit_dried',
    'veg_fresh','peppers','onions','leafy_veg','veg_products','root_veg','potatoes','tomatoes','veg_frozen','veg_preserved'
  ]::text[] then
    return 'food';
  end if;

  v_group := public.infer_public_filter_group(p_name,null);
  if v_group <> 'other' then
    if v_group='garden' and n ~ '(^| )(syr[a-z0-9]*|halloumi|hermelin[a-z0-9]*|camembert[a-z0-9]*|klobas[a-z0-9]*|parek|parky|maso|kure[a-z0-9]*|vepr[a-z0-9]*|hovez[a-z0-9]*)( |$)' then
      return 'food';
    end if;
    return v_group;
  end if;

  if n ~ '(^| )(hummus|kreveta|krevety|chobotnice|makronka|makronky|babovka|jerky|jiska|sushi|medovnik|krajic|chilli con carne|salamky)( |$)' then
    return 'food';
  end if;
  if n ~ '(^| )(merlot|cabernet|sauvignon|veltliner|cerveza|tonic|kafe|coffee|secco|elixir)( |$)' then
    return 'drinks';
  end if;

  return 'other';
end;
$$;

create or replace function public.sanitize_lidl_verified_title(p_title text)
returns text
language sql
immutable
parallel safe
set search_path to 'public','pg_temp'
as $$
  with step1 as (
    select btrim(regexp_replace(coalesce(p_title,''), '^\*{0,2}\s*doporučená prodejní cena výrobce\s+', '', 'i')) as value
  ), step2 as (
    select btrim(regexp_replace(
      value,
      '^Od\s+(pondělí|úterý|středy|středa|čtvrtka|pátku|pátek|soboty|sobota|neděle)\s+[0-9]{1,2}\.\s*[0-9]{1,2}\.\s*do\s*[0-9]{1,2}\.\s*[0-9]{1,2}\.\s+',
      '',
      'i'
    )) as value
    from step1
  )
  select case
    when value ~ '^[0-9]+([.,][0-9]+)?([[:space:]]+[0-9]+([.,][0-9]+)?)+$' then ''
    else value
  end
  from step2;
$$;

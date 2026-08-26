create or replace function public.public_semantic_offer_matches_normalized(
  p_tag text,
  p_semantic_tags text[],
  p_normalized_title text,
  p_normalized_all_text text
)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = 'public','pg_temp'
as $function$
declare
  n text := coalesce(p_normalized_title,'');
  all_text text := coalesce(p_normalized_all_text,'');
  tags text[] := coalesce(p_semantic_tags,'{}'::text[]);
  has_beer boolean := tags @> array['beer']::text[];
  has_milk boolean := tags @> array['milk']::text[];
  has_eggs boolean := tags @> array['eggs']::text[];
  has_butter boolean := tags @> array['butter']::text[];
  has_cheese boolean := tags @> array['cheese']::text[];
  has_meat boolean := tags @> array['meat']::text[];
  has_fruit boolean := tags @> array['fruit_fresh']::text[];
begin
  if p_tag is null then return false; end if;

  case p_tag
    when 'beer_lager' then return has_beer and n ~ '(^| )lezak[a-z0-9]*( |$)';
    when 'beer_draught' then return has_beer and n ~ '(^| )vycepni[a-z0-9]*( |$)';
    when 'beer_nonalc' then return has_beer and n ~ '(^| )(nealko|nealkohol[a-z0-9]*)( |$)';
    when 'beer_radler' then return has_beer and n ~ '(^| )radler[a-z0-9]*( |$)';
    when 'beer_can' then return has_beer and all_text ~ '(^| )plech[a-z0-9]*( |$)';
    when 'beer_bottle' then return has_beer and all_text ~ '(^| )(lahev|lahv[a-z0-9]*|sklo)( |$)';
    when 'beer_multipack' then return has_beer and (all_text ~ '(^| )multipack( |$)' or all_text ~ '[2-9][0-9]*x[0-9]');

    when 'milk_fullfat' then return has_milk and (n ~ '(^| )plnotuc[a-z0-9]*( |$)' or n ~ '(^| )3 5( |$)' or n ~ '(^| )3 6( |$)');
    when 'milk_semiskim' then return has_milk and n ~ '(^| )polotuc[a-z0-9]*( |$)';
    when 'milk_lactosefree' then return has_milk and n ~ '(^| )bezlaktoz[a-z0-9]*( |$)';
    when 'plant_drink' then return n ~ '(^| )(ovesn[a-z0-9]*|ryzov[a-z0-9]*|mandlov[a-z0-9]*|sojov[a-z0-9]*|kokosov[a-z0-9]*|liskooriskov[a-z0-9]*|kesu[a-z0-9]*) napoj[a-z0-9]*( |$)';
    when 'milk_fresh' then return has_milk and n ~ '(^| )(cerstv[a-z0-9]*|farmarsk[a-z0-9]*)( |$)' and n !~ '(^| )(trvanliv[a-z0-9]*|tvanliv[a-z0-9]*)( |$)';
    when 'milk_uht' then return has_milk and n ~ '(^| )(trvanliv[a-z0-9]*|tvanliv[a-z0-9]*)( |$)';
    when 'milk_condensed' then return has_milk and n ~ '(^| )(kondenz[a-z0-9]*|salko)( |$)';

    when 'eggs_chicken' then return has_eggs and n !~ '(^| )krepel[a-z0-9]*( |$)';
    when 'eggs_quail' then return has_eggs and n ~ '(^| )krepel[a-z0-9]*( |$)';
    when 'eggs_m' then return has_eggs and n ~ '(^| )m( |$)';
    when 'eggs_l' then return has_eggs and n ~ '(^| )l( |$)';
    when 'eggs_free_range' then return has_eggs and n ~ '(^| )(voln[a-z0-9]* vybeh[a-z0-9]*|z volneho vybehu)( |$)';
    when 'eggs_barn' then return has_eggs and n ~ '(^| )podestyl[a-z0-9]*( |$)';
    when 'eggs_bio' then return has_eggs and n ~ '(^| )bio( |$)';

    when 'butter_classic' then return has_butter and n !~ '(^| )(ghee|ghi|prepust[a-z0-9]*|solen[a-z0-9]*|ochuc[a-z0-9]*|bylink[a-z0-9]*|cesnek[a-z0-9]*)( |$)';
    when 'butter_ghee' then return has_butter and n ~ '(^| )(ghee|ghi|prepust[a-z0-9]*)( |$)';
    when 'butter_salted' then return has_butter and n ~ '(^| )solen[a-z0-9]*( |$)';
    when 'butter_flavoured' then return has_butter and n ~ '(^| )(ochuc[a-z0-9]*|bylink[a-z0-9]*|cesnek[a-z0-9]*)( |$)';
    when 'butter_block' then return has_butter and n !~ '(^| )(ghee|ghi|prepust[a-z0-9]*)( |$)' and all_text !~ '(^| )(kelimek[a-z0-9]*|vana|doza|sklenic[a-z0-9]*)( |$)';
    when 'butter_tub' then return has_butter and all_text ~ '(^| )(kelimek[a-z0-9]*|vana|doza)( |$)';

    when 'cheese_hermelin' then return has_cheese and n ~ '(^| )hermelin[a-z0-9]*( |$)' and n !~ '(^| )pomazank[a-z0-9]*( |$)';
    when 'cheese_mozzarella' then return has_cheese and n ~ '(^| )mozzarell[a-z0-9]*( |$)';
    when 'cheese_processed' then return has_cheese and n ~ '(^| )taven[a-z0-9]*( |$)';
    when 'cheese_hard' then return has_cheese and n ~ '(^| )(tvrd[a-z0-9]*|polotvrd[a-z0-9]*|eidam[a-z0-9]*|gouda|cheddar[a-z0-9]*|emmental[a-z0-9]*|maasdam[a-z0-9]*|parmezan[a-z0-9]*|grana)( |$)';
    when 'cheese_soft' then return has_cheese and n ~ '(^| )(mekk[a-z0-9]*|cerstv[a-z0-9]*|kremov[a-z0-9]*|termiz[a-z0-9]*|camembert[a-z0-9]*|hermelin[a-z0-9]*|mozzarell[a-z0-9]*|niva|rondel[a-z0-9]*|gervais|lucina)( |$)';
    when 'cheese_sliced' then return has_cheese and n ~ '(^| )platk[a-z0-9]*( |$)';
    when 'cheese_grated' then return has_cheese and n ~ '(^| )strouhan[a-z0-9]*( |$)';

    when 'turkey' then return has_meat and n ~ '(^| )krut[a-z0-9]*( |$)';
    when 'minced_meat' then return has_meat and n ~ '(^| )(mlet[a-z0-9]*|melnen[a-z0-9]*)( |$)';
    when 'fish' then return n ~ '(^| )(pstruh[a-z0-9]*|losos[a-z0-9]*|tresk[a-z0-9]*|tunak[a-z0-9]*|kapr[a-z0-9]*|makrel[a-z0-9]*|pangasi[a-z0-9]*|sled[a-z0-9]*|sardink[a-z0-9]*|prazm[a-z0-9]*|candat[a-z0-9]*|sumec[a-z0-9]*)( |$)'
      and n !~ '(^| )(prst[a-z0-9]*|salat[a-z0-9]*|pomazank[a-z0-9]*|koreni|konzerv[a-z0-9]*|sushi|pamlsk[a-z0-9]*|hrack[a-z0-9]*|mrizk[a-z0-9]*|surimi|matjes[a-z0-9]*|olej[a-z0-9]*|rezy|kousky)( |$)';
    when 'meat_fresh' then return has_meat and n !~ '(^| )(mrazen[a-z0-9]*|marinad[a-z0-9]*|bbq|barbecue)( |$)';
    when 'meat_frozen' then return has_meat and n ~ '(^| )mrazen[a-z0-9]*( |$)';
    when 'cold_cuts' then return n ~ '(^| )(sunk[a-z0-9]*|salam[a-z0-9]*|klobas[a-z0-9]*|parek|parky|slanina|tlacenk[a-z0-9]*|spekack[a-z0-9]*|sulc|debrecinsk[a-z0-9]*|buckov[a-z0-9]* rolada)( |$)'
      and not (tags @> array['bread']::text[]) and n !~ '(^| )(syr[a-z0-9]*|eidam[a-z0-9]*|pizza|vegetari[a-z0-9]*|vegansk[a-z0-9]*|rostlinn[a-z0-9]*|pomazank[a-z0-9]*|pena|salat[a-z0-9]*|sendvic[a-z0-9]*)( |$)';
    when 'marinated_meat' then return has_meat and n ~ '(^| )(marinad[a-z0-9]*|bbq|barbecue)( |$)';

    when 'fruit_citrus' then return has_fruit and n ~ '(^| )(citron[a-z0-9]*|limet[a-z0-9]*|pomeranc[a-z0-9]*|mandarink[a-z0-9]*|grep[a-z0-9]*)( |$)';
    when 'fruit_berries' then return has_fruit and n ~ '(^| )(jahod[a-z0-9]*|malin[a-z0-9]*|boruv[a-z0-9]*|ostruzin[a-z0-9]*|rybiz[a-z0-9]*)( |$)';
    when 'fruit_exotic' then return has_fruit and n ~ '(^| )(mango|ananas[a-z0-9]*|avokad[a-z0-9]*|kiwi|papaj[a-z0-9]*|marakuj[a-z0-9]*|granatov[a-z0-9]*)( |$)';

    else return tags @> array[p_tag]::text[];
  end case;
end;
$function$;

create or replace function public.public_semantic_offer_matches(
  p_tag text,
  p_semantic_tags text[],
  p_title text,
  p_quantity_text text default null
)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(p_title,''));
  all_text text := public.normalize_text(concat_ws(' ',p_title,p_quantity_text));
begin
  return public.public_semantic_offer_matches_normalized(p_tag,p_semantic_tags,n,all_text);
end;
$function$;

create or replace function public.get_public_semantic_filter_counts(
  p_queries text[],
  p_include_upcoming boolean default true,
  p_store_slug text default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_only_images boolean default false,
  p_filter_group text default null,
  p_region_code text default null,
  p_city_name text default null
)
returns table(query text, total_count bigint)
language sql
stable
set search_path = 'public'
set plan_cache_mode = 'force_custom_plan'
as $function$
with params as materialized (
  select
    (timezone('Europe/Prague', now()))::date as today,
    nullif(trim(lower(coalesce(p_store_slug,''))),'') as store_slug,
    nullif(trim(lower(coalesce(p_filter_group,''))),'') as filter_group,
    nullif(trim(upper(coalesce(p_region_code,''))),'') as region_code,
    nullif(trim(public.normalize_text(coalesce(p_city_name,''))),'') as city_name,
    case when p_min_price is null or p_min_price < 0 then null else p_min_price end as min_price,
    case when p_max_price is null or p_max_price < 0 then null else p_max_price end as max_price,
    coalesce(p_only_images,false) as only_images
),
queries as materialized (
  select
    u.query,
    u.ord,
    public.public_semantic_query_tag(u.query) as semantic_tag,
    public.public_semantic_tag_filter_group(public.public_semantic_query_tag(u.query)) as semantic_group
  from unnest(coalesce(p_queries,'{}'::text[])) with ordinality as u(query,ord)
  where nullif(trim(u.query),'') is not null
),
common as materialized (
  select
    c.semantic_tags,
    public.normalize_text(coalesce(c.title,'')) as normalized_title,
    public.normalize_text(concat_ws(' ',c.title,c.product_quantity_text)) as normalized_all_text,
    c.effective_filter_group
  from private.public_offer_search_cache c
  cross join params x
  where c.valid_to >= x.today
    and c.valid_from <= case when p_include_upcoming then x.today + 7 else x.today end
    and (x.store_slug is null or c.store_slug = x.store_slug)
    and (x.min_price is null or c.price >= x.min_price)
    and (x.max_price is null or c.price <= x.max_price)
    and (x.only_images is false or c.image_url is not null)
    and (x.filter_group is null or c.effective_filter_group = x.filter_group)
    and (x.region_code is null or coalesce(c.coverage_scope,'national') = 'national' or c.region_code is null or upper(c.region_code) = x.region_code)
    and (x.city_name is null or c.city_name is null or public.normalize_text(c.city_name) = x.city_name)
    and (
      exists(select 1 from queries q where q.semantic_group is null)
      or c.effective_filter_group in (select distinct q.semantic_group from queries q where q.semantic_group is not null)
    )
),
counts as (
  select
    q.ord,
    q.query,
    count(c.*)::bigint as total_count
  from queries q
  left join common c
    on q.semantic_tag is not null
   and (q.semantic_group is null or c.effective_filter_group = q.semantic_group)
   and public.public_semantic_offer_matches_normalized(q.semantic_tag,c.semantic_tags,c.normalized_title,c.normalized_all_text)
  group by q.ord,q.query
)
select query,total_count
from counts
order by ord;
$function$;

revoke all on function public.public_semantic_offer_matches_normalized(text,text[],text,text) from public;
revoke all on function public.public_semantic_offer_matches(text,text[],text,text) from public;
revoke all on function public.get_public_semantic_filter_counts(text[],boolean,text,numeric,numeric,boolean,text,text,text) from public;
grant execute on function public.public_semantic_offer_matches(text,text[],text,text) to anon, authenticated;
grant execute on function public.get_public_semantic_filter_counts(text[],boolean,text,numeric,numeric,boolean,text,text,text) to anon, authenticated;
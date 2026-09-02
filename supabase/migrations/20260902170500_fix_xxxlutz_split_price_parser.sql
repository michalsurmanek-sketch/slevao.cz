-- XXXLutz/Jina started splitting prices across multiple markdown lines, e.g.
--   9 999,
--   ‒
--   Kč
-- instead of `9 999,‒ Kč`.
-- Keep 100% coverage of percentage sale cards while allowing old_price to be absent
-- when the card still has an explicit SLEVA %, current price, official image and product URL.

create or replace function public.parse_xxxlutz_leaflets_markdown(
  p_markdown text,
  p_snapshot_date date
)
returns table(
  external_id text,
  title text,
  normalized_title text,
  price numeric,
  old_price numeric,
  discount_percent integer,
  valid_from date,
  valid_to date,
  source_url text,
  image_url text,
  xxxlutz_product_key text
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
with src as (
  select replace(replace(coalesce(p_markdown,''), chr(160), ' '), ' ', ' ') as c
), cards0 as (
  select
    ord,
    trim(split_part((m)[3], ' - ', 1)) as raw_title,
    replace((m)[2], ' ', '')::numeric as price,
    nullif(replace(coalesce((m)[1],''), ' ', ''),'')::numeric as old_price,
    (m)[5]::integer as discount_percent,
    (m)[4] as image_url
  from src,
       lateral regexp_matches(
         c,
         E'(?:(?:~~místo ([0-9][0-9 ]*),‒Kč\\*\\*~~[[:space:]]*))?([0-9][0-9 ]*),[[:space:]]*‒[[:space:]]*Kč[[:space:]]*vč[.] DPH[[:space:]]*plus[[:space:]]*!\\[Image [0-9]+: ([^]]+)\\]\\((https://media[.]xxxlutz[.]com/[^ )]+)\\)[[:space:]]*SLEVA ([0-9]+)%',
         'g'
       ) with ordinality z(m,ord)
), cards as (
  select
    ord,
    regexp_replace(raw_title, '[[:space:],]+$', '', 'g') as title,
    public.normalize_product_name(raw_title) as match_key,
    price,
    old_price,
    discount_percent,
    image_url,
    row_number() over (
      partition by public.normalize_product_name(raw_title)
      order by ord
    ) as key_rn
  from cards0
  where price > 0
    and (old_price is null or old_price > price)
    and discount_percent between 5 and 90
    and image_url like 'https://media.xxxlutz.com/%'
), lines as (
  select ord,line
  from src,
       lateral regexp_split_to_table(c,E'\\n') with ordinality t(line,ord)
), urls0 as (
  select
    ord,
    trim((m)[1]) as link_title,
    (m)[2] as url,
    substring((m)[2] from '-([0-9A-Za-z]+)$') as product_key
  from lines,
       lateral regexp_match(
         line,
         E'^- \\[([^]]+)\\]\\((https://www[.]xxxlutz[.]cz/p/[^ )]+)\\)$'
       ) m
  where m is not null
), urls as (
  select
    ord,
    public.normalize_product_name(link_title) as match_key,
    url,
    product_key,
    row_number() over (
      partition by public.normalize_product_name(link_title)
      order by ord
    ) as key_rn
  from urls0
  where product_key is not null
)
select
  'xxxlutz:' || u.product_key,
  c.title,
  public.normalize_product_name(c.title),
  c.price,
  c.old_price,
  c.discount_percent,
  p_snapshot_date,
  p_snapshot_date,
  u.url,
  c.image_url,
  u.product_key
from cards c
join urls u using(match_key,key_rn)
where p_snapshot_date is not null
  and u.url like 'https://www.xxxlutz.cz/p/%';
$function$;

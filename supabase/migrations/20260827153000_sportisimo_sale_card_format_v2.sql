create or replace function public.parse_sportisimo_sale_markdown(p_markdown text)
returns table(
  external_id text,
  title text,
  normalized_title text,
  subtitle text,
  price numeric,
  old_price numeric,
  discount_percent integer,
  valid_from date,
  valid_to date,
  source_url text,
  sportisimo_product_id text
)
language sql
stable
set search_path = public, pg_temp
as $function$
with src as (
  select replace(coalesce(p_markdown,''), chr(160), ' ') as c
), bounds as (
  select c,
         position('Řadit dle:' in c) as product_start,
         position('Dalších 48 produktů' in c) as product_end,
         case when position('Řadit dle:' in c)>1 then left(c,position('Řadit dle:' in c)-1) else c end as promo_header
  from src
), dates as (
  select c,product_start,product_end,
         regexp_match(promo_header,'od[[:space:]]+([0-9]{1,2})[.][[:space:]]*([0-9]{1,2})[.][[:space:]]*([0-9]{4})') as m_from,
         regexp_match(promo_header,'do[[:space:]]+([0-9]{1,2})[.][[:space:]]*([0-9]{1,2})[.][[:space:]]*([0-9]{4})') as m_to
  from bounds
), prepared as (
  select c,
         case when product_start>0 and product_end>product_start then substring(c from product_start for product_end-product_start) else '' end as product_text,
         case when m_from is not null then make_date((m_from)[3]::int,(m_from)[2]::int,(m_from)[1]::int) end as vf,
         case when m_to is not null then make_date((m_to)[3]::int,(m_to)[2]::int,(m_to)[1]::int) end as vt
  from dates
), product_lines as (
  select ord,
         btrim(line) as line,
         lag(btrim(line),2) over(order by ord) as title,
         lag(btrim(line),1) over(order by ord) as subtitle,
         lead(btrim(line),1) over(order by ord) as price_line,
         lead(btrim(line),2) over(order by ord) as old_price_line,
         lead(btrim(line),3) over(order by ord) as stock_line,
         vf,vt,c
  from prepared,
       lateral string_to_table(product_text, chr(10)) with ordinality as t(line,ord)
), current_cards0 as (
  select ord,
         title,
         subtitle,
         replace(substring(price_line from '^([0-9][0-9 ]*) Kč$'),' ','')::numeric as price,
         substring(line from '^Výprodej -([0-9]+)%$')::int as discount_percent,
         replace(substring(old_price_line from '^([0-9][0-9 ]*) Kč$'),' ','')::numeric as old_price,
         vf,vt,c
  from product_lines
  where line ~ '^Výprodej -[0-9]+%$'
    and price_line ~ '^[0-9][0-9 ]* Kč$'
    and old_price_line ~ '^[0-9][0-9 ]* Kč$'
    and stock_line='Skladem'
), legacy_cards0 as (
  select ord,
         (x)[1] as title,
         (x)[2] as subtitle,
         replace((x)[3],' ','')::numeric as price,
         (x)[4]::int as discount_percent,
         replace((x)[5],' ','')::numeric as old_price,
         vf,vt,c
  from prepared,
       lateral regexp_matches(
         product_text,
         E'(?:^|\\n)(?:[0-9]+\\n)?([^\\n]{3,120})\\n([^\\n]{2,120})\\n([0-9][0-9 ]*) Kč \\(-([0-9]+) %\\)\\n(?:DMOC: )?([0-9][0-9 ]*) Kč\\nSkladem',
         'g'
       ) with ordinality as z(x,ord)
), cards0 as (
  select * from current_cards0
  union all
  select * from legacy_cards0
  where not exists (select 1 from current_cards0)
), cards as (
  select *,
         regexp_replace(public.normalize_product_name(title),'[^a-z0-9]+','','g') as match_key,
         row_number() over(
           partition by regexp_replace(public.normalize_product_name(title),'[^a-z0-9]+','','g')
           order by ord
         ) as key_rn
  from cards0
  where price>0 and old_price>price and discount_percent between 5 and 90
), lines as (
  select ord,line
  from prepared,
       lateral string_to_table(c, chr(10)) with ordinality as t(line,ord)
), urls0 as (
  select ord,
         substring(line from 'https://www[.]sportisimo[.]cz/([^/ )]+)/[^/ )]+/[0-9]+/') as brand_slug,
         substring(line from 'https://www[.]sportisimo[.]cz/[^/ )]+/([^/ )]+)/[0-9]+/') as model_slug,
         substring(line from 'https://www[.]sportisimo[.]cz/[^/ )]+/[^/ )]+/([0-9]+)/') as product_id,
         substring(line from '(https://www[.]sportisimo[.]cz/[^ )]+/[0-9]+/)') as url
  from lines
  where substring(line from 'https://www[.]sportisimo[.]cz/[^/ )]+/[^/ )]+/([0-9]+)/') is not null
), urls as (
  select *,
         regexp_replace(
           public.normalize_product_name(replace(brand_slug,'-',' ')||' '||replace(model_slug,'-',' ')),
           '[^a-z0-9]+','','g'
         ) as match_key,
         row_number() over(
           partition by regexp_replace(
             public.normalize_product_name(replace(brand_slug,'-',' ')||' '||replace(model_slug,'-',' ')),
             '[^a-z0-9]+','','g'
           )
           order by ord
         ) as key_rn
  from urls0
)
select 'sportisimo:'||u.product_id,
       c.title,
       public.normalize_product_name(c.title),
       c.subtitle,
       c.price,
       c.old_price,
       c.discount_percent,
       c.vf,
       c.vt,
       u.url,
       u.product_id
from cards c
join urls u using(match_key,key_rn)
where c.vf is not null
  and c.vt is not null
  and c.vf<=c.vt
  and u.url like 'https://www.sportisimo.cz/%';
$function$;

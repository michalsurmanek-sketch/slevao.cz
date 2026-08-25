create or replace function public.parse_pro_doma_event_markdown(p_markdown text, p_event_url text)
returns table(
  external_id text,
  title text,
  normalized_title text,
  quantity_text text,
  price numeric,
  old_price numeric,
  valid_from date,
  valid_to date,
  source_url text,
  image_url text,
  metadata jsonb
)
language sql
stable
set search_path to 'public','pg_temp'
as $function$
with parts as (
  select coalesce(p_markdown,'') raw,
         case when strpos(coalesce(p_markdown,''),'## Výpis produktů')>0
              then left(p_markdown,strpos(p_markdown,'## Výpis produktů')-1)
              else coalesce(p_markdown,'') end promo_header
), eligibility as (
  select raw,promo_header,
         not (lower(promo_header) like '%jako dárek%' or lower(promo_header) like '%získáte jako dárek%') allowed_price_event
  from parts
), txt as (
  select raw,promo_header,allowed_price_event,replace(raw,'**',' ') t from eligibility
), d1 as (
  select *,regexp_match(t,'od[[:space:]]+([0-9]{1,2})[.][[:space:]]*([0-9]{1,2})[.][[:space:]]+do[[:space:]]+([0-9]{1,2})[.][[:space:]]*([0-9]{1,2})[.][[:space:]]*([0-9]{4})') m1 from txt
), d2 as (
  select *,regexp_match(t,'od[[:space:]]+([0-9]{1,2})[.][[:space:]]*([0-9]{1,2})[.][[:space:]]*([0-9]{4})[[:space:]]+do[[:space:]]+([0-9]{1,2})[.][[:space:]]*([0-9]{1,2})[.][[:space:]]*([0-9]{4})') m2 from d1
), d3 as (
  select *,regexp_match(t,'([0-9]{1,2})[.][[:space:]]*([0-9]{1,2})[.][[:space:]]*([0-9]{4})[[:space:]]*-[[:space:]]*([0-9]{1,2})[.][[:space:]]*([0-9]{1,2})[.][[:space:]]*([0-9]{4})') m3 from d2
), range as (
  select raw,allowed_price_event,
         case
           when m2 is not null then make_date((m2)[3]::int,(m2)[2]::int,(m2)[1]::int)
           when m1 is not null then make_date((m1)[5]::int,(m1)[2]::int,(m1)[1]::int)
           when m3 is not null then make_date((m3)[3]::int,(m3)[2]::int,(m3)[1]::int)
         end vf,
         case
           when m2 is not null then make_date((m2)[6]::int,(m2)[5]::int,(m2)[4]::int)
           when m1 is not null then make_date((m1)[5]::int,(m1)[4]::int,(m1)[3]::int)
           when m3 is not null then make_date((m3)[6]::int,(m3)[5]::int,(m3)[4]::int)
         end vt
  from d3
), section as (
  select substring(raw from strpos(raw,'## Výpis produktů')) s,vf,vt
  from range
  where allowed_price_event and vf is not null and vt is not null and strpos(raw,'## Výpis produktů')>0
), blocks as (
  select vf,vt,ord,block
  from section,lateral regexp_split_to_table(s,E'\\n\\[!\\[Image') with ordinality x(block,ord)
  where ord>1
), parsed as (
  select vf,vt,ord,block,
    substring(block from 'https://img[.]pro-doma[.]cz/userimages/product_main/[^)]+') img,
    substring(block from 'https://(?:www|assets)[.]pro-doma[.]cz/[^ )]+') raw_url,
    substring(block from E'### \\[([^]]+)\\]') ttl,
    substring(block from E'\\*\\*([0-9][0-9 ]*,[0-9][0-9])\\*\\*Kč/([[:alnum:]²³]+) s DPH') ptxt,
    substring(block from E'\\*\\*[0-9][0-9 ]*,[0-9][0-9]\\*\\*Kč/([[:alnum:]²³]+) s DPH') unit,
    coalesce(
      substring(block from E'Akce-[0-9]+%[[:space:]]+([0-9][0-9 ]*,[0-9][0-9])[[:space:]]+Kč'),
      substring(block from E'Ceníková cena dodavatele:[[:space:]]+([0-9][0-9 ]*,[0-9][0-9])[[:space:]]+Kč')
    ) otxt
  from blocks
), canonical as (
  select p.*,regexp_replace(raw_url,'^https://assets[.]pro-doma[.]cz/','https://www.pro-doma.cz/') url
  from parsed p
), safe as (
  select p.*,
         replace(replace(ptxt,' ',''),',','.')::numeric cp,
         case when otxt is null then null else replace(replace(otxt,' ',''),',','.')::numeric end op
  from canonical p
  where img is not null and url is not null and ttl is not null and ptxt is not null
)
select
  'prodoma:'||md5(url),
  ttl,
  public.normalize_product_name(ttl),
  unit,
  cp,
  case when op>cp then op else null end,
  vf,
  vt,
  url,
  img,
  jsonb_build_object(
    'adapter','pro-doma-jina-events-v1',
    'parser_version','pro-doma-jina-events-v2-assets',
    'event_url',p_event_url,
    'price_unit',unit,
    'price_policy','consumer_price_including_vat'
  )
from safe
where cp>0 and cp<=100000 and vf<=vt
  and url like 'https://www.pro-doma.cz/%'
  and img like 'https://img.pro-doma.cz/%';
$function$;

create or replace function public.sanitize_lidl_verified_title(p_title text)
returns text
language sql
immutable
parallel safe
set search_path to 'public','pg_temp'
as $$
  select btrim(regexp_replace(coalesce(p_title,''), '^\*{0,2}\s*doporučená prodejní cena výrobce\s+', '', 'i'));
$$;

create or replace function public.parse_lidl_verified_markdown(p_markdown text, p_valid_from date, p_valid_to date)
returns table(external_key text, title text, normalized_title text, quantity_text text, price numeric, unit_price numeric, valid_from date, valid_to date, metadata jsonb)
language sql
stable
set search_path to 'public','pg_temp'
as $$
with paras0 as (
  select ord,trim(p) raw0
  from regexp_split_to_table(coalesce(p_markdown,''),E'\n\s*\n') with ordinality x(p,ord)
), paras as (
  select ord,
    translate(raw0,'⁰¹²³⁴⁵⁶⁷⁸⁹','0123456789') raw,
    trim(regexp_replace(regexp_replace(translate(raw0,'⁰¹²³⁴⁵⁶⁷⁸⁹','0123456789'),'(?m)^\s*(?:#{1,4}|>)[ ]*','','g'),'\s+',' ','g')) txt
  from paras0
), price_rows as (
  select ord,txt,raw,
    case
      when raw~'^#\s*\d{1,4}\.\d{1,2}\s*$' then substring(raw from '^#\s*(\d{1,4})')::numeric+substring(raw from '^#\s*\d{1,4}\.(\d{1,2})')::numeric/100
      when raw~'^#\s*\d{1,4}\.\-\s*$' then substring(raw from '^#\s*(\d{1,4})')::numeric
    end price
  from paras
  where raw~'^#\s*\d{1,4}\.(\d{1,2}|\-)\s*$'
), linked as (
  select pr.ord price_ord,pr.price,q.ord qty_ord,q.txt qty_text,t.txt raw_title,
    (select p2.txt from paras p2 where p2.ord>pr.ord and p2.txt~*'Nabídka zboží platí' order by p2.ord limit 1) next_legal,
    (select p2.txt from paras p2 where p2.ord<pr.ord and p2.txt~*'Nabídka zboží platí' order by p2.ord desc limit 1) prev_legal
  from price_rows pr
  cross join lateral (
    select q.* from paras q
    where q.ord<pr.ord and q.ord>=pr.ord-5
      and q.txt~*'[0-9]+([,.][0-9]+)?\s*(g|kg|ml|l)(\s|,|$)'
      and q.txt~*'(1\s*(kg|l)|100\s*(g|ml))\s*=\s*[0-9]+[,.][0-9]+\s*Kč'
      and q.txt!~*'[×x]|\s/\s|Lidl Plus|různé velikosti'
    order by q.ord desc limit 1
  ) q
  cross join lateral (
    select t.* from paras t
    where t.ord<q.ord and t.ord>=q.ord-3
      and length(t.txt) between 3 and 100
      and t.txt!~*'Lidl Plus|^(Super cena|Ušetřete|Novinka|Cenový|trumf|různé druhy|více druhů|Max\.|cena za|REGION|Více na|Od čtvrtka|Nabídka|Aktivuj|Kompletní|Ceny v klidu|Další ceny|Další produkty)$'
      and t.txt!~*'^[-–+%0-9# ]+$|www\.|Kč'
    order by t.ord desc limit 1
  ) t
  where pr.price between 2 and 5000
    and not exists(select 1 from price_rows e where e.ord>q.ord and e.ord<pr.ord)
    and not exists(select 1 from paras x where x.ord between q.ord and pr.ord and x.txt~*'S Lidl Plus|Lidl Plus|Aktivuj kupón')
    and not exists(select 1 from paras x where x.ord between pr.ord and pr.ord+2 and x.txt~*'S Lidl Plus|Lidl Plus')
), legal_dates as (
  select l.*,
    regexp_match(next_legal,'platí od\s*([0-9]{1,2})\.\s*([0-9]{1,2})\.\s*do\s*([0-9]{1,2})\.\s*([0-9]{1,2})\.\s*(20[0-9]{2})','i') next_m,
    regexp_match(prev_legal,'platí od\s*([0-9]{1,2})\.\s*([0-9]{1,2})\.\s*do\s*([0-9]{1,2})\.\s*([0-9]{1,2})\.\s*(20[0-9]{2})','i') prev_m,
    regexp_match(qty_text,'([0-9]+(?:[,.][0-9]+)?)\s*(g|kg|ml|l)(?:\s|,|$)') qm,
    regexp_match(qty_text,'(1\s*(kg|l)|100\s*(g|ml))\s*=\s*([0-9]+[,.][0-9]+)\s*Kč','i') um
  from linked l
), parsed as (
  select *,
    case when next_m is not null then to_date(next_m[1]||'.'||next_m[2]||'.'||next_m[5],'DD.MM.YYYY') end next_from,
    case when next_m is not null then to_date(next_m[3]||'.'||next_m[4]||'.'||next_m[5],'DD.MM.YYYY') end next_to,
    case when prev_m is not null then to_date(prev_m[1]||'.'||prev_m[2]||'.'||prev_m[5],'DD.MM.YYYY') end prev_from,
    case when prev_m is not null then to_date(prev_m[3]||'.'||prev_m[4]||'.'||prev_m[5],'DD.MM.YYYY') end prev_to,
    replace(qm[1],',','.')::numeric qty_number,
    lower(qm[2]) qty_unit,
    replace(um[4],',','.')::numeric printed_unit_price,
    (replace(qm[1],',','.')::numeric)::text||' '||lower(qm[2]) simple_quantity,
    public.sanitize_lidl_verified_title(raw_title) clean_title
  from legal_dates
  where qm is not null and um is not null
), checked as (
  select *,case
    when qty_unit='g' and um[1]~*'^1\s*kg' then price/(qty_number/1000)
    when qty_unit='kg' and um[1]~*'^1\s*kg' then price/qty_number
    when qty_unit='ml' and um[1]~*'^1\s*l' then price/(qty_number/1000)
    when qty_unit='l' and um[1]~*'^1\s*l' then price/qty_number
    when qty_unit='g' and um[1]~*'^100\s*g' then price/(qty_number/100)
    when qty_unit='ml' and um[1]~*'^100\s*ml' then price/(qty_number/100)
  end expected_unit_price
  from parsed
), valid as (
  select * from checked
  where next_m is not null
    and next_from=p_valid_from and next_to=p_valid_to
    and (
      prev_legal is null
      or (prev_m is not null and prev_from=p_valid_from and prev_to=p_valid_to)
    )
    and expected_unit_price is not null
    and abs(expected_unit_price-printed_unit_price)<=greatest(0.3,printed_unit_price*0.02)
    and clean_title!~*'Lidl Plus|^(na gril|chlazený|chlazená|baleno|vakuově|uzená/neuzená|různé druhy|více druhů|pečeně|Original|párky)$'
    and clean_title!~*'^(Jakub Přibyl, sommelier Lidlu|Od pondělí\s+[0-9]{1,2}\.\s*[0-9]{1,2}\.\s*do\s*[0-9]{1,2}\.\s*[0-9]{1,2}\.|Premiéra v Lidlu)$'
    and length(public.normalize_product_name(clean_title))>=3
), ranked as (
  select *,row_number() over(
    partition by public.normalize_product_name(clean_title),simple_quantity
    order by price,price_ord
  ) rn
  from valid
)
select
  md5(public.normalize_product_name(clean_title)||'|'||simple_quantity),
  clean_title,
  public.normalize_product_name(clean_title),
  simple_quantity,
  price,
  printed_unit_price,
  p_valid_from,
  p_valid_to,
  jsonb_build_object(
    'adapter','lidl-verified-pdf-text-v2',
    'source_confidence',0.99,
    'verification','printed_unit_price_math_and_strict_adjacent_validity',
    'printed_unit_price',printed_unit_price,
    'coverage_note','conservative subset; Lidl Plus, long-term prices and ambiguous layouts excluded'
  )
from ranked
where rn=1;
$$;

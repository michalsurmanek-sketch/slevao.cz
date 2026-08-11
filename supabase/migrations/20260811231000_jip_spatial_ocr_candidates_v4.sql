-- Conservative JIP OCR parser v4. Native Tesseract emits the unit-price line
-- as e.g. "100 g = 20,80". We derive the package price only when the same
-- visual product box contains an explicit package quantity and a product label.

create or replace function public.jip_spatial_ocr_candidates_v4(p_import_id uuid)
returns table(
  title text,
  normalized_title text,
  quantity_text text,
  price numeric,
  source_page integer,
  confidence numeric,
  raw_data jsonb
)
language sql
stable
set search_path to 'public'
as $function$
with lines as (
  select
    p.page_number,
    (w->>'block')::integer as block_no,
    (w->>'paragraph')::integer as paragraph_no,
    (w->>'line')::integer as line_no,
    string_agg(w->>'text',' ' order by (w->>'left')::numeric) as text,
    avg((w->>'confidence')::numeric) as conf,
    min((w->>'left')::numeric) as l,
    max((w->>'left')::numeric + (w->>'width')::numeric) as r,
    min((w->>'top')::numeric) as t,
    max((w->>'top')::numeric + (w->>'height')::numeric) as b
  from public.leaflet_ocr_pages p
  cross join lateral jsonb_array_elements(p.words) w
  where p.import_id=p_import_id
  group by p.page_number,(w->>'block')::integer,(w->>'paragraph')::integer,(w->>'line')::integer
), enriched as (
  select *, (l+r)/2 as cx, (t+b)/2 as cy, lower(unaccent(text)) as ntext
  from lines
  where coalesce(text,'')<>''
), equations as (
  select e.*,
    case
      when ntext ~ '100\s*g\s*=\s*[0-9]+[,.][0-9]+' then 100::numeric
      when ntext ~ '1\s*kg\s*=\s*[0-9]+[,.][0-9]+' then 1000::numeric
      when ntext ~ '1\s*l\s*=\s*[0-9]+[,.][0-9]+' then 1000::numeric
      else null
    end as basis,
    case when ntext ~ '1\s*l\s*=' then 'ml' else 'g' end as base_unit,
    replace((regexp_match(ntext,'=\s*([0-9]{1,4}[,.][0-9]{1,2})'))[1],',','.')::numeric as unit_price
  from enriched e
  where conf>=55
    and ntext ~ '(100\s*g|1\s*kg|1\s*l)\s*=\s*[0-9]{1,4}[,.][0-9]{1,2}'
), packages as (
  select
    q.*,
    eq.page_number as eq_page,
    eq.text as equation_text,
    eq.conf as equation_conf,
    eq.basis,
    eq.base_unit,
    eq.unit_price,
    eq.cx as eq_cx,
    eq.cy as eq_cy,
    row_number() over(partition by eq.page_number,eq.block_no,eq.paragraph_no,eq.line_no order by
      abs(q.cx-eq.cx)+abs(q.cy-eq.cy)*1.35
    ) as rn
  from equations eq
  join enriched q on q.page_number=eq.page_number
    and q.conf>=55
    and abs(q.cx-eq.cx)<=250
    and q.cy between eq.cy-210 and eq.cy+120
    and q.ntext !~ '(cena|dph|nabidka|super cena|pri koupi|kup vic|kupon|aplikac|karta|sleva|www\.)'
    and q.ntext !~ '=\s*[0-9]'
    and q.ntext ~ '[[:alpha:]]{3,}'
    and q.ntext ~ '[0-9]+(?:[,.][0-9]+)?\s*(kg|g|ml|l)([^[:alpha:]]|$)'
), parsed as (
  select p.*,
    replace((regexp_match(p.ntext,'([0-9]+(?:[,.][0-9]+)?)\s*(kg|g|ml|l)([^[:alpha:]]|$)'))[1],',','.')::numeric as qty_amount,
    (regexp_match(p.ntext,'([0-9]+(?:[,.][0-9]+)?)\s*(kg|g|ml|l)([^[:alpha:]]|$)'))[2] as qty_unit
  from packages p where rn=1
), computed as (
  select *,
    case
      when qty_unit='kg' then qty_amount*1000
      when qty_unit='g' then qty_amount
      when qty_unit='l' then qty_amount*1000
      when qty_unit='ml' then qty_amount
    end as qty_base
  from parsed
), sane as (
  select *, round(unit_price*qty_base/basis,1) as derived_price
  from computed
  where qty_base>0
    and ((base_unit='g' and qty_unit in ('g','kg')) or (base_unit='ml' and qty_unit in ('ml','l')))
)
select
  btrim(regexp_replace(text,'\s+',' ','g')) as title,
  public.normalize_product_name(text) as normalized_title,
  replace(qty_amount::text,'.',',')||' '||qty_unit as quantity_text,
  derived_price as price,
  eq_page as source_page,
  least(0.99, greatest(0.90, least(conf,equation_conf)/100.0))::numeric as confidence,
  jsonb_build_object(
    'parser','jip-spatial-ocr-v4',
    'deterministic',true,
    'equation',equation_text,
    'unit_price',unit_price,
    'unit_basis',basis||' '||base_unit,
    'derived_from_unit_equation',true,
    'ocr_title_confidence',conf,
    'ocr_equation_confidence',equation_conf
  ) as raw_data
from sane
where derived_price between 2 and 5000
  and length(public.normalize_product_name(text))>=4
  and public.product_label_is_specific(text)
  and lower(unaccent(text)) !~ '^(cena|akce|novinka|vybrane druhy|ruzné druhy|různé druhy)'
order by eq_page,t,l;
$function$;

revoke execute on function public.jip_spatial_ocr_candidates_v4(uuid) from public,anon,authenticated;
grant execute on function public.jip_spatial_ocr_candidates_v4(uuid) to service_role;

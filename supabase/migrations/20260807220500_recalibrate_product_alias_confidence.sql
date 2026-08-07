-- Slevao.cz: historické aliasy bez nezávislého signálu identity nesmí dál
-- vystupovat jako téměř jisté. Nic nemažeme; pouze kalibrujeme confidence a
-- doplňujeme důvěryhodná metadata z dnešních ověřených nabídek.

update public.product_aliases
set confidence = least(confidence, 0.7000),
    updated_at = now()
where source_store_id is not null
  and coalesce(public.normalize_product_name(brand), '') = ''
  and public.product_quantity_key(quantity_text) is null
  and confidence >= 0.9000;

with candidates as (
  select
    o.product_id,
    o.title as alias,
    public.normalize_product_name(o.title) as normalized_alias,
    nullif(p.brand, '') as brand,
    coalesce(
      public.product_quantity_key(o.title),
      public.product_quantity_key(p.quantity_text),
      public.product_quantity_key(p.name)
    ) as quantity_text,
    o.store_id as source_store_id,
    case
      when coalesce(public.normalize_product_name(p.brand), '') <> ''
       and coalesce(
         public.product_quantity_key(o.title),
         public.product_quantity_key(p.quantity_text),
         public.product_quantity_key(p.name)
       ) is not null
      then 1.0000::numeric
      else 0.9800::numeric
    end as confidence,
    row_number() over (
      partition by o.product_id, public.normalize_product_name(o.title)
      order by
        (coalesce(public.normalize_product_name(p.brand), '') <> '') desc,
        (coalesce(
          public.product_quantity_key(o.title),
          public.product_quantity_key(p.quantity_text),
          public.product_quantity_key(p.name)
        ) is not null) desc,
        o.updated_at desc nulls last,
        o.id
    ) as rn
  from public.offers o
  join public.products p on p.id = o.product_id
  where o.status = 'published'
    and o.valid_from <= current_date
    and o.valid_to >= current_date
    and o.product_id is not null
    and o.is_verified = true
    and o.catalog_match_status in ('matched','retained')
    and public.product_identity_match_safe(o.title, p.name, p.brand, p.quantity_text)
    and (
      coalesce(public.normalize_product_name(p.brand), '') <> ''
      or coalesce(
        public.product_quantity_key(o.title),
        public.product_quantity_key(p.quantity_text),
        public.product_quantity_key(p.name)
      ) is not null
    )
)
insert into public.product_aliases(
  product_id,
  alias,
  normalized_alias,
  brand,
  quantity_text,
  source_store_id,
  confidence
)
select
  product_id,
  alias,
  normalized_alias,
  brand,
  quantity_text,
  source_store_id,
  confidence
from candidates
where rn = 1
on conflict (product_id, normalized_alias)
do update set
  alias = excluded.alias,
  brand = coalesce(excluded.brand, product_aliases.brand),
  quantity_text = coalesce(excluded.quantity_text, product_aliases.quantity_text),
  source_store_id = coalesce(excluded.source_store_id, product_aliases.source_store_id),
  confidence = excluded.confidence,
  updated_at = now();

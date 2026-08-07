-- Slevao.cz: jednorázově sjednotí pouze dnešní ověřené needs_review nabídky,
-- které mají právě jeden JINÝ master produkt se stejným přesným normalizovaným
-- názvem a projdou bezpečnou kontrolou identity (zejména gramáž/značka).
-- Žádné fuzzy párování a žádné mazání produktů.

create temp table _slevao_exact_verified_relinks on commit drop as
with offer_base as (
  select
    o.id,
    o.title,
    o.product_id,
    public.normalize_product_name(o.title) as normalized_title
  from public.offers o
  where o.status = 'published'
    and o.valid_from <= current_date
    and o.valid_to >= current_date
    and o.catalog_match_status = 'needs_review'
    and o.is_verified = true
    and o.product_id is not null
), candidate_rows as (
  select
    ob.id as offer_id,
    ob.product_id as current_product_id,
    p.id as candidate_product_id
  from offer_base ob
  join public.products p
    on p.normalized_name = ob.normalized_title
  where p.id is distinct from ob.product_id
    and public.product_identity_match_safe(
      ob.title,
      p.name,
      p.brand,
      p.quantity_text
    )
), unique_candidates as (
  select
    offer_id,
    min(current_product_id::text)::uuid as current_product_id,
    min(candidate_product_id::text)::uuid as candidate_product_id,
    count(distinct candidate_product_id) as candidate_count
  from candidate_rows
  group by offer_id
)
select offer_id,current_product_id,candidate_product_id
from unique_candidates
where candidate_count = 1;

-- Zachovat shodnou vazbu i u zdrojových položek importu.
update public.leaflet_import_items li
set product_id = r.candidate_product_id
from _slevao_exact_verified_relinks r
join public.offers o on o.id = r.offer_id
where li.product_id = r.current_product_id
  and li.title = o.title;

-- Samotný UPDATE nabídky ještě projde novým ochranným BEFORE triggerem.
-- Pokud by mezitím bezpečná identita přestala platit, trigger změnu vrátí zpět.
update public.offers o
set product_id = r.candidate_product_id
from _slevao_exact_verified_relinks r
where o.id = r.offer_id;

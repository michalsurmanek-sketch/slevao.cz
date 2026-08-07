-- Kofola 2 l: tři ověřené master produkty se stejnou značkou a balením.
with candidates as (
  select id,normalized_name
  from public.products
  where is_verified = true
    and public.normalize_product_name(brand) = 'kofola'
    and public.product_quantity_key(coalesce(quantity_text,name)) = '2l'
    and normalized_name in ('kofola','kofola 2 l','kofola original 2 l')
), guarded as (
  select count(*) as candidate_count from candidates
), pairs as (
  select a.id as product_id_a,b.id as product_id_b
  from candidates a
  join candidates b on a.id::text < b.id::text
  cross join guarded g
  where g.candidate_count = 3
)
insert into public.product_equivalences(product_id_a,product_id_b,match_method,confidence,evidence)
select product_id_a,product_id_b,'curated_brand_quantity',1.0000,
       jsonb_build_object(
         'brand','Kofola',
         'quantity','2 l',
         'reason','Curated verified master equivalence: generic Kofola 2 l labels and Kofola Original 2 l refer to the same reviewed product identity.',
         'reviewed_at',now()
       )
from pairs
on conflict do nothing;

-- ITALAT Mozzarella 100 g: jeden zdroj má značku v titulku, druhý v brand poli.
with candidates as (
  select id,normalized_name
  from public.products
  where is_verified = true
    and public.normalize_product_name(brand) = 'italat'
    and public.product_quantity_key(coalesce(quantity_text,name)) = '100g'
    and normalized_name in ('italat mozzarella 100 g','mozzarella 100 g')
), guarded as (
  select count(*) as candidate_count from candidates
), pair as (
  select a.id as product_id_a,b.id as product_id_b
  from candidates a
  join candidates b on a.id::text < b.id::text
  cross join guarded g
  where g.candidate_count = 2
)
insert into public.product_equivalences(product_id_a,product_id_b,match_method,confidence,evidence)
select product_id_a,product_id_b,'curated_brand_quantity',1.0000,
       jsonb_build_object(
         'brand','ITALAT',
         'quantity','100 g',
         'product','Mozzarella',
         'reason','Curated verified master equivalence: product name, brand and package agree; one source omits the brand in the offer title.',
         'reviewed_at',now()
       )
from pair
on conflict do nothing;

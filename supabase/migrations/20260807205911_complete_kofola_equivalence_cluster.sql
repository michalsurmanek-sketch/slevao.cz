with candidates as (
  select id,normalized_name,name
  from public.products
  where is_verified = true
    and public.normalize_product_name(brand) = 'kofola'
    and public.product_quantity_key(coalesce(quantity_text,name)) = '2l'
    and normalized_name in ('kofola','kofola 2 l','kofola original 2 l')
), guarded as (
  select count(*) as candidate_count,
         count(*) filter (where normalized_name='kofola') as generic_count,
         count(*) filter (where normalized_name='kofola 2 l') as quantity_label_count,
         count(*) filter (where normalized_name='kofola original 2 l') as original_count
  from candidates
), pairs as (
  select a.id as product_id_a,b.id as product_id_b
  from candidates a
  join candidates b on a.id::text < b.id::text
  cross join guarded g
  where g.candidate_count = 4
    and g.generic_count = 1
    and g.quantity_label_count = 2
    and g.original_count = 1
)
insert into public.product_equivalences(product_id_a,product_id_b,match_method,confidence,evidence)
select product_id_a,product_id_b,'curated_brand_quantity',1.0000,
       jsonb_build_object(
         'brand','Kofola',
         'quantity','2 l',
         'reason','Curated verified Kofola 2 l cluster. Generic and Original labels were reviewed as the same product identity; duplicate punctuation variants are included.',
         'reviewed_at',now()
       )
from pairs
on conflict do nothing;

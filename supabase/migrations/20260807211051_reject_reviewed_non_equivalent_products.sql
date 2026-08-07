with reviewed as (
  select product_id_a,product_id_b,brand,quantity_key,product_name_a,product_name_b,
         case
           when public.normalize_product_name(brand)='le co'
             and quantity_key='100g'
             and (
               (public.normalize_product_name(product_name_a) like '%debrecinska%' and public.normalize_product_name(product_name_b) like '%sunka%')
               or
               (public.normalize_product_name(product_name_b) like '%debrecinska%' and public.normalize_product_name(product_name_a) like '%sunka%')
             )
           then 'Different LE & CO products: ham versus Debrecin/Kladno roast.'
           when public.normalize_product_name(brand)='olma'
             and quantity_key='150g'
             and (
               (public.normalize_product_name(product_name_a) like '%florian%' and public.normalize_product_name(product_name_b) like '%bio jogurt%')
               or
               (public.normalize_product_name(product_name_b) like '%florian%' and public.normalize_product_name(product_name_a) like '%bio jogurt%')
             )
           then 'Different OLMA product lines: Florian flavoured yoghurt versus Bio yoghurt.'
           else null
         end as rejection_reason
  from public.product_equivalence_review_queue
), guarded as (
  select * from reviewed where rejection_reason is not null
)
insert into public.product_equivalences(
  product_id_a,product_id_b,match_method,confidence,evidence,is_active
)
select
  product_id_a,product_id_b,'manual_review',0.0000,
  jsonb_build_object(
    'approved',false,
    'reviewed_at',now(),
    'reason',rejection_reason,
    'source','curated_review_batch'
  ),
  false
from guarded
on conflict do nothing;

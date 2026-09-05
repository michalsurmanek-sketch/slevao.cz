drop trigger if exists trg_propagate_product_category_to_offers on public.products;
create trigger trg_propagate_product_category_to_offers
after update on public.products
for each row
when (old.category_id is distinct from new.category_id)
execute function public.propagate_product_category_to_offers();

update public.offers o
set category_id=p.category_id
from public.products p
where p.id=o.product_id
  and o.category_id is distinct from p.category_id;
-- home-v2 requests offers.category_id and the nested categories relation. The column
-- was missing even though product categories are part of the public UI, forcing a
-- failing REST request before the client falls back to a reduced query.

alter table public.offers
  add column if not exists category_id uuid references public.categories(id) on delete set null;

create index if not exists idx_offers_category_id on public.offers(category_id);

update public.offers o
set category_id = p.category_id
from public.products p
where p.id = o.product_id
  and o.category_id is distinct from p.category_id;

create or replace function public.sync_offer_category_from_product()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.product_id is null then
    new.category_id := null;
  else
    select p.category_id into new.category_id
    from public.products p
    where p.id = new.product_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_offer_category_from_product on public.offers;
create trigger trg_sync_offer_category_from_product
before insert or update of product_id on public.offers
for each row execute function public.sync_offer_category_from_product();

create or replace function public.propagate_product_category_to_offers()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.category_id is distinct from old.category_id then
    update public.offers
    set category_id = new.category_id
    where product_id = new.id
      and category_id is distinct from new.category_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_propagate_product_category_to_offers on public.products;
create trigger trg_propagate_product_category_to_offers
after update of category_id on public.products
for each row execute function public.propagate_product_category_to_offers();

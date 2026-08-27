-- Add a current baseline only for reassigned live offers with a stable structured
-- identity key. Historical rows stay attached to the product identity they had
-- when the price was recorded.
insert into public.price_history (
  product_id,
  store_id,
  branch_id,
  offer_id,
  price,
  old_price,
  unit_price,
  valid_from,
  valid_to,
  source_url
)
select
  o.product_id,
  o.store_id,
  o.branch_id,
  o.id,
  o.price,
  o.old_price,
  o.unit_price,
  o.valid_from,
  o.valid_to,
  o.source_url
from public.offers o
join public.products p on p.id = o.product_id
where o.status = 'published'
  and nullif(o.external_id, '') is not null
  and o.metadata->>'structured_identity_key' = o.external_id
  and public.normalize_product_name(o.title) = public.normalize_product_name(p.name)
  and exists (
    select 1
    from public.price_history old
    where old.offer_id = o.id
      and old.product_id is distinct from o.product_id
  )
  and not exists (
    select 1
    from public.price_history current_identity
    where current_identity.offer_id = o.id
      and current_identity.product_id = o.product_id
  );

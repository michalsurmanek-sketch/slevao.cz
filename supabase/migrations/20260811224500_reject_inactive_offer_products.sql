-- Last-line database guard: an offer may never be published against a product
-- that catalogue quality controls have deactivated. Try an active rematch first;
-- if no safe active identity exists, reject the write so the importer marks the
-- item failed instead of reviving quarantined garbage.

create or replace function public.ensure_offer_product_active_before_write()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  resolved record;
  is_active_product boolean;
begin
  if new.product_id is null then return new; end if;

  select p.is_active into is_active_product
  from public.products p
  where p.id = new.product_id;

  if coalesce(is_active_product,false) then return new; end if;

  select * into resolved
  from public.resolve_product_for_import(new.title, null, null, null, new.store_id)
  limit 1;

  if resolved.matched_product_id is not null then
    new.product_id := resolved.matched_product_id;
    new.catalog_match_status := 'matched';
    new.catalog_match_score := resolved.match_score;
    new.catalog_checked_at := now();
    return new;
  end if;

  raise exception 'Offer cannot reference inactive product % without a safe active replacement.', new.product_id
    using errcode = '23514';
end;
$function$;

drop trigger if exists zy_ensure_offer_product_active_before_write on public.offers;
create trigger zy_ensure_offer_product_active_before_write
before insert or update of product_id,title,store_id
on public.offers
for each row execute function public.ensure_offer_product_active_before_write();

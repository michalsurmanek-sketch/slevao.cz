create or replace function private.mark_public_offer_search_cache_dirty_if_rows()
returns trigger
language plpgsql
security definer
set search_path to 'private','pg_temp'
as $function$
declare
  v_transaction_id text := pg_current_xact_id()::text;
begin
  if not exists (select 1 from changed_rows limit 1) then
    return null;
  end if;

  insert into private.public_offer_search_cache_dirty_transactions(
    transaction_id,
    first_change_at,
    last_change_at,
    last_change_source
  )
  values (
    v_transaction_id,
    clock_timestamp(),
    clock_timestamp(),
    concat_ws('.', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP)
  )
  on conflict (transaction_id) do update
    set last_change_at = excluded.last_change_at,
        last_change_source = excluded.last_change_source;

  return null;
end;
$function$;

revoke all on function private.mark_public_offer_search_cache_dirty_if_rows() from public;

-- offers
drop trigger if exists trg_public_offer_search_cache_dirty_offers on public.offers;
drop trigger if exists trg_public_offer_search_cache_dirty_offers_insert on public.offers;
drop trigger if exists trg_public_offer_search_cache_dirty_offers_update on public.offers;
drop trigger if exists trg_public_offer_search_cache_dirty_offers_delete on public.offers;
drop trigger if exists trg_public_offer_search_cache_dirty_offers_truncate on public.offers;

create trigger trg_public_offer_search_cache_dirty_offers_insert
after insert on public.offers
referencing new table as changed_rows
for each statement
execute function private.mark_public_offer_search_cache_dirty_if_rows();

create trigger trg_public_offer_search_cache_dirty_offers_update
after update on public.offers
referencing new table as changed_rows
for each statement
execute function private.mark_public_offer_search_cache_dirty_if_rows();

create trigger trg_public_offer_search_cache_dirty_offers_delete
after delete on public.offers
referencing old table as changed_rows
for each statement
execute function private.mark_public_offer_search_cache_dirty_if_rows();

create trigger trg_public_offer_search_cache_dirty_offers_truncate
after truncate on public.offers
for each statement
execute function private.mark_public_offer_search_cache_dirty();

-- products
drop trigger if exists trg_public_offer_search_cache_dirty_products on public.products;
drop trigger if exists trg_public_offer_search_cache_dirty_products_insert on public.products;
drop trigger if exists trg_public_offer_search_cache_dirty_products_update on public.products;
drop trigger if exists trg_public_offer_search_cache_dirty_products_delete on public.products;
drop trigger if exists trg_public_offer_search_cache_dirty_products_truncate on public.products;

create trigger trg_public_offer_search_cache_dirty_products_insert
after insert on public.products
referencing new table as changed_rows
for each statement
execute function private.mark_public_offer_search_cache_dirty_if_rows();

create trigger trg_public_offer_search_cache_dirty_products_update
after update on public.products
referencing new table as changed_rows
for each statement
execute function private.mark_public_offer_search_cache_dirty_if_rows();

create trigger trg_public_offer_search_cache_dirty_products_delete
after delete on public.products
referencing old table as changed_rows
for each statement
execute function private.mark_public_offer_search_cache_dirty_if_rows();

create trigger trg_public_offer_search_cache_dirty_products_truncate
after truncate on public.products
for each statement
execute function private.mark_public_offer_search_cache_dirty();

-- stores
drop trigger if exists trg_public_offer_search_cache_dirty_stores on public.stores;
drop trigger if exists trg_public_offer_search_cache_dirty_stores_insert on public.stores;
drop trigger if exists trg_public_offer_search_cache_dirty_stores_update on public.stores;
drop trigger if exists trg_public_offer_search_cache_dirty_stores_delete on public.stores;
drop trigger if exists trg_public_offer_search_cache_dirty_stores_truncate on public.stores;

create trigger trg_public_offer_search_cache_dirty_stores_insert
after insert on public.stores
referencing new table as changed_rows
for each statement
execute function private.mark_public_offer_search_cache_dirty_if_rows();

create trigger trg_public_offer_search_cache_dirty_stores_update
after update on public.stores
referencing new table as changed_rows
for each statement
execute function private.mark_public_offer_search_cache_dirty_if_rows();

create trigger trg_public_offer_search_cache_dirty_stores_delete
after delete on public.stores
referencing old table as changed_rows
for each statement
execute function private.mark_public_offer_search_cache_dirty_if_rows();

create trigger trg_public_offer_search_cache_dirty_stores_truncate
after truncate on public.stores
for each statement
execute function private.mark_public_offer_search_cache_dirty();

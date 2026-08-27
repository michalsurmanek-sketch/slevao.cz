-- Least-privilege hardening for public-schema client roles.
-- RLS remains the row-level enforcement layer; these grants remove SQL powers
-- that browser/API clients never need (TRUNCATE/TRIGGER/REFERENCES) and remove
-- anonymous access to private user-owned tables.

-- No web client needs schema-changing or table-wide destructive privileges.
do $block$
declare
  r record;
begin
  for r in
    select format('%I.%I', n.nspname, c.relname) as qualified_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','p')
  loop
    execute format('revoke truncate, trigger, references on table %s from anon', r.qualified_name);
    execute format('revoke truncate, trigger, references on table %s from authenticated', r.qualified_name);
  end loop;
end
$block$;

-- Anonymous visitors must not have direct CRUD grants on user-owned/private data.
revoke all privileges on table public.profiles from anon;
revoke all privileges on table public.favorites from anon;
revoke all privileges on table public.product_favorites from anon;
revoke all privileges on table public.price_alerts from anon;
revoke all privileges on table public.notifications from anon;
revoke all privileges on table public.shopping_lists from anon;
revoke all privileges on table public.shopping_list_items from anon;
revoke all privileges on table public.shopping_list_purchases from anon;
revoke all privileges on table public.shopping_list_shares from anon;
revoke all privileges on table public.recently_viewed_products from anon;
revoke all privileges on table public.web_push_subscriptions from anon;
revoke all privileges on table public.web_push_deliveries from anon;

-- Anonymous users are intentionally allowed to submit a bounded offer report;
-- the existing RLS policy enforces status='new', note length, and null user_id.
revoke all privileges on table public.offer_reports from anon;
grant insert on table public.offer_reports to anon;

-- Albert publishes separate official materials for hypermarkets and supermarkets.
-- Preserve that distinction on offers so different format-specific prices are
-- not presented as one anonymous national Albert price.

create or replace function public.sync_offer_store_format_from_metadata()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  store_slug text;
  location_type text;
begin
  if new.store_id is null then
    return new;
  end if;

  select s.slug into store_slug
  from public.stores s
  where s.id = new.store_id;

  if store_slug <> 'albert' then
    return new;
  end if;

  location_type := upper(coalesce(new.metadata ->> 'location_type', ''));

  if location_type = 'HYPERMARKET' then
    new.store_location_name := 'Hypermarket';
  elsif location_type = 'SUPERMARKET' then
    new.store_location_name := 'Supermarket';
  end if;

  return new;
end;
$function$;

revoke all on function public.sync_offer_store_format_from_metadata() from public, anon, authenticated;
grant execute on function public.sync_offer_store_format_from_metadata() to service_role;

drop trigger if exists trg_sync_offer_store_format_from_metadata on public.offers;
create trigger trg_sync_offer_store_format_from_metadata
before insert or update of store_id, metadata on public.offers
for each row
execute function public.sync_offer_store_format_from_metadata();

update public.offers o
set store_location_name = case upper(coalesce(o.metadata ->> 'location_type', ''))
      when 'HYPERMARKET' then 'Hypermarket'
      when 'SUPERMARKET' then 'Supermarket'
      else o.store_location_name
    end,
    updated_at = now()
from public.stores s
where s.id = o.store_id
  and s.slug = 'albert'
  and upper(coalesce(o.metadata ->> 'location_type', '')) in ('HYPERMARKET','SUPERMARKET')
  and coalesce(o.store_location_name, '') is distinct from case upper(coalesce(o.metadata ->> 'location_type', ''))
      when 'HYPERMARKET' then 'Hypermarket'
      when 'SUPERMARKET' then 'Supermarket'
      else coalesce(o.store_location_name, '')
    end;
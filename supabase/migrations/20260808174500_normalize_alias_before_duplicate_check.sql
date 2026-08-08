create or replace function public.ignore_duplicate_product_alias_before_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  new.normalized_alias := public.normalize_product_name(new.alias);

  if exists (
    select 1
    from public.product_aliases pa
    where pa.product_id = new.product_id
      and pa.normalized_alias = new.normalized_alias
  ) then
    return null;
  end if;

  return new;
end;
$function$;

-- Run the duplicate guard after the normalizer for readability as well; the
-- function itself also normalizes, so the behavior is safe regardless of order.
drop trigger if exists aaa_ignore_duplicate_product_alias_before_insert on public.product_aliases;
drop trigger if exists zzz_ignore_duplicate_product_alias_before_insert on public.product_aliases;
create trigger zzz_ignore_duplicate_product_alias_before_insert
before insert on public.product_aliases
for each row
execute function public.ignore_duplicate_product_alias_before_insert();
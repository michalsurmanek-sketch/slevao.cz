-- Product aliases are an identity cache. Re-inserting the same alias for the
-- same canonical product must be a no-op, not a sync-breaking unique error.

create or replace function public.ignore_duplicate_product_alias_before_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
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

revoke all on function public.ignore_duplicate_product_alias_before_insert() from public, anon, authenticated;
grant execute on function public.ignore_duplicate_product_alias_before_insert() to service_role;

drop trigger if exists aaa_ignore_duplicate_product_alias_before_insert on public.product_aliases;
create trigger aaa_ignore_duplicate_product_alias_before_insert
before insert on public.product_aliases
for each row
execute function public.ignore_duplicate_product_alias_before_insert();
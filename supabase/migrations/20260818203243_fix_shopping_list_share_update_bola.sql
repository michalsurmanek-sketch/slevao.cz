do $guard$
declare
  v_qual text;
  v_check text;
begin
  select qual,with_check
  into v_qual,v_check
  from pg_policies
  where schemaname='public'
    and tablename='shopping_list_shares'
    and policyname='shopping_list_shares_owner_update'
    and cmd='UPDATE';

  if v_qual is null or v_check is null then
    raise exception 'Expected shopping_list_shares_owner_update policy was not found.';
  end if;

  if position('created_by' in v_qual)=0 or position('created_by' in v_check)=0 then
    raise exception 'Shopping-list share update policy drifted from the expected owner check.';
  end if;
end
$guard$;

drop policy if exists shopping_list_shares_owner_update on public.shopping_list_shares;

create policy shopping_list_shares_owner_update
on public.shopping_list_shares
for update
to authenticated
using (
  created_by = (select auth.uid())
  and exists (
    select 1
    from public.shopping_lists sl
    where sl.id = shopping_list_shares.shopping_list_id
      and sl.user_id = (select auth.uid())
  )
)
with check (
  created_by = (select auth.uid())
  and exists (
    select 1
    from public.shopping_lists sl
    where sl.id = shopping_list_shares.shopping_list_id
      and sl.user_id = (select auth.uid())
  )
);

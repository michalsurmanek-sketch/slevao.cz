create or replace function public.guard_web_push_subscription_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception using
      errcode = '42501',
      message = 'Vlastníka push subscription nelze změnit.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_web_push_subscription_owner() from public, anon, authenticated;

drop trigger if exists guard_web_push_subscription_owner_trg on public.web_push_subscriptions;
create trigger guard_web_push_subscription_owner_trg
before update of user_id on public.web_push_subscriptions
for each row
execute function public.guard_web_push_subscription_owner();

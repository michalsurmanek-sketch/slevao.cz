do $guard$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.web_push_subscriptions'::regclass
      and conname='web_push_subscriptions_endpoint_length_chk'
  ) then
    alter table public.web_push_subscriptions
      add constraint web_push_subscriptions_endpoint_length_chk
      check (length(endpoint) between 16 and 2048);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.web_push_subscriptions'::regclass
      and conname='web_push_subscriptions_user_agent_length_chk'
  ) then
    alter table public.web_push_subscriptions
      add constraint web_push_subscriptions_user_agent_length_chk
      check (user_agent is null or length(user_agent) <= 500);
  end if;
end
$guard$;

create or replace function public.guard_notification_user_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  -- Service-role/server writes have no end-user auth.uid(); admins/editors are
  -- intentionally allowed to manage notification content through existing RLS.
  if v_user_id is null or public.is_admin() then
    return new;
  end if;

  if old.user_id is distinct from v_user_id
     or new.user_id is distinct from v_user_id then
    raise exception using
      errcode = '42501',
      message = 'Uživatel může upravit pouze vlastní upozornění.';
  end if;

  -- End users may only change the read state. Comparing the complete row minus
  -- is_read also protects any notification columns added in future migrations.
  if (to_jsonb(new) - 'is_read') is distinct from (to_jsonb(old) - 'is_read') then
    raise exception using
      errcode = '42501',
      message = 'Obsah upozornění nelze uživatelsky měnit.';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_notification_user_update() from public, anon, authenticated;

drop trigger if exists guard_notification_user_update_trg on public.notifications;
create trigger guard_notification_user_update_trg
before update on public.notifications
for each row
execute function public.guard_notification_user_update();

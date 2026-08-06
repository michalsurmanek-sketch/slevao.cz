create or replace function public.mark_manual_offer_trash_lock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'trash'
     and old.status is distinct from 'trash'
     and not (coalesce(new.metadata, '{}'::jsonb) ? '_bulk_reset_run_id') then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      '_manual_delete_lock', true,
      '_manual_deleted_at', now()
    );
  end if;

  if old.status = 'trash'
     and new.status is distinct from 'trash' then
    new.metadata := coalesce(new.metadata, '{}'::jsonb)
      - '_manual_delete_lock'
      - '_manual_deleted_at';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_mark_manual_offer_trash_lock on public.offers;
create trigger trg_mark_manual_offer_trash_lock
before update of status, metadata
on public.offers
for each row
execute function public.mark_manual_offer_trash_lock();

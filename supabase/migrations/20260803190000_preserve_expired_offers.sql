-- Slevao.cz: prošlé nabídky se už fyzicky nemažou.
-- Zůstanou v administraci jako ukončené a veřejný web je díky stavu a datu nezobrazí.

create or replace function public.archive_and_delete_expired_offers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_count integer := 0;
begin
  insert into public.expired_offer_archive (
    original_offer_id,
    valid_to,
    offer_snapshot,
    archived_at
  )
  select
    o.id,
    o.valid_to,
    to_jsonb(o),
    now()
  from public.offers o
  where o.valid_to < current_date
    and o.status not in ('expired', 'trash')
  on conflict (original_offer_id) do update set
    valid_to = excluded.valid_to,
    offer_snapshot = excluded.offer_snapshot,
    archived_at = excluded.archived_at;

  update public.offers
  set status = 'expired',
      published_at = null
  where valid_to < current_date
    and status not in ('expired', 'trash');

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

revoke all on function public.archive_and_delete_expired_offers() from public;
grant execute on function public.archive_and_delete_expired_offers() to service_role;

-- Okamžitě opraví případné právě prošlé nabídky bez fyzického smazání.
select public.archive_and_delete_expired_offers();

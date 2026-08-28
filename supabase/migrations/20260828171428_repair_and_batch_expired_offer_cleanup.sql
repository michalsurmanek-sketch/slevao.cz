create index if not exists offers_expiry_cleanup_idx
  on public.offers(valid_to, id);

create or replace function public.archive_and_delete_expired_offers()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (timezone('Europe/Prague', now()))::date;
  v_batch_limit constant integer := 250;
  v_offer_ids uuid[] := array[]::uuid[];
  v_deleted_count integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('slevao:archive_expired_offers', 0)) then
    return 0;
  end if;

  select coalesce(array_agg(q.id), array[]::uuid[])
    into v_offer_ids
  from (
    select o.id
    from public.offers o
    where o.valid_to < v_today
    order by o.valid_to, o.id
    limit v_batch_limit
    for update skip locked
  ) q;

  if cardinality(v_offer_ids) = 0 then
    return 0;
  end if;

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
    clock_timestamp()
  from public.offers o
  where o.id = any(v_offer_ids)
  on conflict (original_offer_id) do update set
    valid_to = excluded.valid_to,
    offer_snapshot = excluded.offer_snapshot,
    archived_at = excluded.archived_at;

  update public.price_history ph
     set metadata = ph.metadata
                    || jsonb_build_object('archived_offer_id', ph.offer_id::text)
                    || case
                         when nullif(btrim(ph.source_url), '') is null
                          and coalesce(nullif(btrim(ph.metadata->>'provenance'), ''), '') = ''
                         then jsonb_build_object('provenance', 'expired_offer_archive')
                         else '{}'::jsonb
                       end
   where ph.offer_id = any(v_offer_ids);

  delete from public.offers o
   where o.id = any(v_offer_ids)
     and o.valid_to < v_today;

  get diagnostics v_deleted_count = row_count;
  return v_deleted_count;
end;
$$;

revoke all on function public.archive_and_delete_expired_offers() from public, anon, authenticated;
grant execute on function public.archive_and_delete_expired_offers() to postgres, service_role;

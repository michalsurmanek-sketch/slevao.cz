create or replace function public.sync_flop_source_health_from_product_state()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_current_count integer := 0;
  v_success_at timestamptz := coalesce(new.last_success_at,new.last_run_at,now());
begin
  if new.health_status='ok'
     and new.last_error is null
     and exists(select 1 from public.stores s where s.id=new.store_id and s.slug='flop')
  then
    select count(*)
      into v_current_count
    from public.offers o
    where o.store_id=new.store_id
      and o.status='published'
      and o.is_verified=true
      and o.valid_from<=v_today
      and o.valid_to>=v_today;

    if v_current_count>0 then
      update public.leaflet_sources ls
         set last_error=null,
             last_checked_at=greatest(coalesce(ls.last_checked_at,'-infinity'::timestamptz),v_success_at),
             last_success_at=greatest(coalesce(ls.last_success_at,'-infinity'::timestamptz),v_success_at),
             last_strategy_used='dedicated-products-verified',
             last_strategy_success_at=greatest(coalesce(ls.last_strategy_success_at,'-infinity'::timestamptz),v_success_at)
       where ls.store_id=new.store_id
         and ls.is_active=true;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_flop_source_health_from_product_state() from public,anon,authenticated;
grant execute on function public.sync_flop_source_health_from_product_state() to postgres,service_role;

drop trigger if exists trg_sync_flop_source_health_from_product_state on public.store_product_sync_state;
create trigger trg_sync_flop_source_health_from_product_state
after insert or update of health_status,last_error,last_success_at,last_offer_count,last_published_count
on public.store_product_sync_state
for each row execute function public.sync_flop_source_health_from_product_state();

update public.store_product_sync_state st
set updated_at=now()
where st.store_id=(select id from public.stores where slug='flop' limit 1)
  and st.health_status='ok'
  and st.last_error is null;

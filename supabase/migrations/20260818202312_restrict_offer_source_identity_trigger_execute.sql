do $guard$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='set_offer_source_identity'
      and p.prorettype='trigger'::regtype
      and p.prosecdef=true
  ) then
    raise exception 'Expected public.set_offer_source_identity() SECURITY DEFINER trigger function was not found.';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_proc p on p.oid=t.tgfoid
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal
      and n.nspname='public'
      and c.relname='offers'
      and t.tgname='trg_set_offer_source_identity'
      and p.proname='set_offer_source_identity'
  ) then
    raise exception 'Expected offers trigger trg_set_offer_source_identity was not found.';
  end if;
end
$guard$;

revoke execute on function public.set_offer_source_identity() from public;
revoke execute on function public.set_offer_source_identity() from anon;
revoke execute on function public.set_offer_source_identity() from authenticated;
grant execute on function public.set_offer_source_identity() to service_role;

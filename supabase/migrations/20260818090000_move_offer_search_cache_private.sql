-- Hide the materialized search cache from the exposed public Data API while
-- preserving SECURITY INVOKER RPC access through explicit SQL privileges.

alter materialized view public.public_offer_search_cache set schema private;

grant usage on schema private to anon, authenticated;
grant select on private.public_offer_search_cache to anon, authenticated, service_role;

-- SQL functions store their textual body with the old schema-qualified name.
-- Rewrite every public function that depends on this cache atomically.
do $$
declare
  r record;
  ddl text;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%public.public_offer_search_cache%'
  loop
    ddl := replace(
      pg_get_functiondef(r.oid),
      'public.public_offer_search_cache',
      'private.public_offer_search_cache'
    );
    execute ddl;
  end loop;
end $$;

-- Keep the existing five-minute refresh cadence after the schema move.
select cron.alter_job(
  job_id := 129,
  command := 'REFRESH MATERIALIZED VIEW private.public_offer_search_cache'
);

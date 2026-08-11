-- PostgreSQL does not provide min(uuid). Cast UUIDs to text for the
-- single-match lookup and cast the selected value back to uuid.
do $$
declare
  function_sql text;
begin
  select pg_get_functiondef('public.attach_leaflet_location_to_offer()'::regprocedure)
  into function_sql;

  if function_sql not like '%min(o.id)%' then
    return;
  end if;

  function_sql := replace(function_sql, 'min(o.id)', 'min(o.id::text)::uuid');
  execute function_sql;
end;
$$;

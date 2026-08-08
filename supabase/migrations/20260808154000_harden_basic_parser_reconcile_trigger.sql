-- Avoid referencing OLD on INSERT even though the previous boolean expression normally
-- short-circuited. Keep trigger semantics explicit for PostgreSQL trigger operations.
create or replace function public.reconcile_completed_basic_parser_run()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'completed' then
      perform public.reconcile_basic_parser_import(new.import_id);
    end if;
  elsif new.status = 'completed' and old.status is distinct from new.status then
    perform public.reconcile_basic_parser_import(new.import_id);
  end if;
  return new;
end;
$$;

revoke execute on function public.reconcile_completed_basic_parser_run() from public, anon, authenticated;

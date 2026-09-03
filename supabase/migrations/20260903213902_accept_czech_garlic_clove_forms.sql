do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('public.get_public_shopping_list_candidates(text[],integer)'::regprocedure)
    into definition;
  definition := replace(
    definition,
    'kg|g|ml|l|ks|balení|stroužky',
    'kg|g|ml|l|ks|balení|stroužek|stroužky|stroužků'
  );
  execute definition;
end
$migration$;

do $migration$
declare
  definition text;
  original text;
begin
  select pg_get_functiondef('public.get_public_shopping_list_candidates(text[],integer)'::regprocedure)
    into definition;
  original := definition;
  definition := replace(
    definition,
    $old$when 'hladka mouka' then 'Pšeničná mouka'
          else q.base_text$old$,
    $new$when 'hladka mouka' then 'Pšeničná mouka'
          when 'rajcatove pyre' then 'Passata'
          else q.base_text$new$
  );
  if definition = original then
    raise exception 'Expected recipe alias fragment was not found';
  end if;
  execute definition;
end
$migration$;

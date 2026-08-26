do $do$
declare
  v_def text;
begin
  select pg_get_functiondef('public.public_offer_semantic_tags(text)'::regprocedure) into v_def;
  v_def := replace(v_def, 'nudl[a-z0-9]*', 'nudle|nudlov[a-z0-9]*');
  execute v_def;
end;
$do$;

do $$
declare
  v_def text := pg_get_functiondef('public.public_offer_semantic_tags(text)'::regprocedure);
begin
  if position('|ryzov[a-z0-9]* chlebick[a-z0-9]*|kukuric[a-z0-9]* chlebick[a-z0-9]*|' in v_def) = 0 then
    raise exception 'bakery cleanup anchor not found';
  end if;
  v_def := replace(
    v_def,
    '|ryzov[a-z0-9]* chlebick[a-z0-9]*|kukuric[a-z0-9]* chlebick[a-z0-9]*|',
    '|ryzov[a-z0-9]* chlebick[a-z0-9]*|kukuric[a-z0-9]* chlebick[a-z0-9]*|chlebick[a-z0-9]* ryzov[a-z0-9]*|chlebick[a-z0-9]* kukuric[a-z0-9]*|'
  );
  execute v_def;
end;
$$;

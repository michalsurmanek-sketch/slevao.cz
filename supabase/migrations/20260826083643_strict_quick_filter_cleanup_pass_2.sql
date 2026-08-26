do $$
declare
  v_def text := pg_get_functiondef('public.public_offer_semantic_tags(text)'::regprocedure);
begin
  if position('|raw star|santee)( |$)' in v_def) = 0 then
    raise exception 'fruit cleanup anchor not found';
  end if;
  v_def := replace(
    v_def,
    '|raw star|santee)( |$)',
    '|raw star|santee|prostredek|gummies|povidl[a-z0-9]*|kapsick[a-z0-9]*|svacink[a-z0-9]*|bulgursalat[a-z0-9]*|bob)( |$)'
  );

  if position('|umel[a-z0-9]* kvetina)( |$)' in v_def) = 0 then
    raise exception 'vegetable cleanup anchor not found';
  end if;
  v_def := replace(
    v_def,
    '|umel[a-z0-9]* kvetina)( |$)',
    '|umel[a-z0-9]* kvetina|protlak[a-z0-9]*|platk[a-z0-9]* kukuric[a-z0-9]*|don peppe|racio|president rondele|k bio kukurice|zlata kukurice)( |$)'
  );

  execute v_def;
end;
$$;

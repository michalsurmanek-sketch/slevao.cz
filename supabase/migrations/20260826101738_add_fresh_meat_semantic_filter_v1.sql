do $migration$
declare d text;
begin
  d := pg_get_functiondef('public.public_semantic_offer_matches(text,text[],text,text)'::regprocedure);
  if position($needle$when 'meat_frozen' then return has_meat$needle$ in d)=0 then
    raise exception 'meat_frozen matcher anchor missing';
  end if;
  d := replace(d,
    $needle$when 'meat_frozen' then return has_meat$needle$,
    $replacement$when 'meat_fresh' then return has_meat and n !~ '(^| )(mrazen[a-z0-9]*|marinad[a-z0-9]*|bbq|barbecue)( |$)';
    when 'meat_frozen' then return has_meat$replacement$
  );
  execute d;

  d := pg_get_functiondef('public.public_semantic_query_tag(text)'::regprocedure);
  if position($needle$when 'maso' then 'meat'$needle$ in d)=0 then
    raise exception 'meat query anchor missing';
  end if;
  d := replace(d,
    $needle$when 'maso' then 'meat'$needle$,
    $replacement$when 'maso' then 'meat'
  when 'cerstve maso' then 'meat_fresh'$replacement$
  );
  execute d;

  d := pg_get_functiondef('public.public_semantic_tag_filter_group(text)'::regprocedure);
  if position($needle$'meat','chicken'$needle$ in d)=0 then
    raise exception 'meat tag group anchor missing';
  end if;
  d := replace(d,$needle$'meat','chicken'$needle$,$replacement$'meat','meat_fresh','chicken'$replacement$);
  execute d;
end;
$migration$;
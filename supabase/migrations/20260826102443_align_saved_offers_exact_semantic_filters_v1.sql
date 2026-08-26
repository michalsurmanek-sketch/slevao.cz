do $migration$
declare d text;
begin
  d := pg_get_functiondef('public.get_public_saved_offer_page(uuid[],integer,integer,text,numeric,numeric,boolean,text,text,text,text,text)'::regprocedure);
  if position('c.semantic_tags @> ARRAY[x.semantic_tag]' in d)=0 then
    raise exception 'saved offer semantic expression not found';
  end if;
  d := replace(d,
    'c.semantic_tags @> ARRAY[x.semantic_tag]',
    'public.public_semantic_offer_matches(x.semantic_tag,c.semantic_tags,c.title,c.product_quantity_text)'
  );
  execute d;
end;
$migration$;
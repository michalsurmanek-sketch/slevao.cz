do $migration$
declare
  fn text := pg_get_functiondef('public.public_offer_semantic_tags(text)'::regprocedure);
  poultry_parts text := '|steh[a-z0-9]*|kridl[a-z0-9]*|palick[a-z0-9]*';
begin
  if position('zebro|zebra|zeber' in fn) = 0 then
    raise exception 'meat rib pattern guard not found';
  end if;
  if position(poultry_parts in fn) = 0 then
    raise exception 'standalone poultry-part pattern guard not found';
  end if;

  fn := replace(fn, 'zebro|zebra|zeber', 'zebro|zeber');
  fn := replace(fn, poultry_parts, '');

  if position('zebro|zebra|zeber' in fn) > 0
     or position(poultry_parts in fn) > 0 then
    raise exception 'semantic tag collision replacement incomplete';
  end if;

  execute fn;
end;
$migration$;
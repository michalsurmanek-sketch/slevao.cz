do $migration$
declare
  fn text := pg_get_functiondef('public.infer_public_filter_group(text,text)'::regprocedure);
  needle text := 'dermacol|max factor|wet n wild|pampers|swiffer';
  replacement text := 'dermacol|max factor|wet n wild|pampers|swiffer|real green';
begin
  if fn is null or position(needle in fn) = 0 then
    raise exception 'infer_public_filter_group brand guard not found';
  end if;
  if position(replacement in fn) > 0 then
    raise exception 'Real Green classifier is already present';
  end if;
  execute replace(fn, needle, replacement);
end;
$migration$;
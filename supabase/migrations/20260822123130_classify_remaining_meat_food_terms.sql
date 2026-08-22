do $migration$
declare
  fn text := pg_get_functiondef('public.infer_public_filter_group(text,text)'::regprocedure);
  needle text := $n$    else 'other'$n$;
  replacement text := $r$    when n ~ '\m(kure|drubez|knedlick[a-z0-9]*|masove kulick[a-z0-9]*|sendvic[a-z0-9]*)\M'
      or (n ~ '\msunko[a-z0-9]*\M' and n !~ '\msunkovar\M')
      then 'food'
    else 'other'$r$;
begin
  if fn is null or position(needle in fn)=0 then
    raise exception 'final food fallback guard not found';
  end if;
  if position('masove kulick[a-z0-9]*' in fn)>0 then
    raise exception 'remaining meat-food terms already present';
  end if;
  execute replace(fn,needle,replacement);
end;
$migration$;
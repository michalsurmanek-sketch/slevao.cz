-- SLEVAO.cz: muffins are food unless the title explicitly describes bakeware/accessories.

set local statement_timeout = '60s';

do $migration$
declare
  d text;
  needle text := $needle$    else 'other'
  end;$needle$;
  replacement text := $replacement$    when n ~ '\mmuffin[a-z]*\M'
      and n !~ '\m(forma|formy|plech|kosick[a-z]*|sada)\M'
      then 'food'
    else 'other'
  end;$replacement$;
begin
  d := pg_get_functiondef('public.infer_public_filter_group(text,text)'::regprocedure);
  if position(needle in d) = 0 then
    raise exception 'infer_public_filter_group tail does not match expected base';
  end if;
  d := replace(d, needle, replacement);
  execute d;
end;
$migration$;

refresh materialized view private.public_offer_search_cache;

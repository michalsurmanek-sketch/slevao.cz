set local statement_timeout = '90s';

do $migration$
declare
  d text;
  old_begin text := $old$begin
  if base_group <> 'other' then$old$;
  new_begin text := $new$begin
  -- Silná identita produktu má přednost před obecnými slovy jako "gril".
  -- Nářadí s potravinovým slovem naopak zůstává mimo potraviny.
  if n ~ '\m(sunkovar|nuz na sunku)\M' then
    return 'home';
  end if;

  if n ~ '\m(pilsner urquell|proud limetka)\M'
     or n ~ '\movocna stava\M' then
    return 'drinks';
  end if;

  if n ~ '\m(kedlub[a-z0-9]*|lilek)\M'
     or n ~ '\m(syrove platky|parenic[a-z0-9]*|syrar[a-z0-9]* vyber)\M'
     or (n ~ '\msyr[a-z0-9]*\M' and n ~ '\m(panev|gril)\M')
     or n ~ '\m(pareck[a-z0-9]*|klobas[a-z0-9]*|horal se syrem)\M'
     or n ~ '\m(losos[a-z0-9]*|pstruh[a-z0-9]*|tresk[a-z0-9]*|tunak[a-z0-9]*|sledov[a-z0-9]*)\M' then
    return 'food';
  end if;

  if base_group <> 'other' then$new$;
begin
  d := pg_get_functiondef('public.resolve_public_filter_group(text,text,text)'::regprocedure);
  if position(old_begin in d)=0 then
    raise exception 'resolve_public_filter_group begin block not found';
  end if;
  d := replace(d,old_begin,new_begin);
  execute d;
end;
$migration$;

select private.refresh_public_offer_search_cache_if_dirty(true);
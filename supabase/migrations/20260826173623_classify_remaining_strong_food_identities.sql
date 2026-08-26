set local statement_timeout = '90s';

do $migration$
declare
  d text;
  old_block text := $old$  if n ~ '\m(kedlub[a-z0-9]*|lilek)\M'
     or n ~ '\m(syrove platky|parenic[a-z0-9]*|syrar[a-z0-9]* vyber)\M'
     or (n ~ '\msyr[a-z0-9]*\M' and n ~ '\m(panev|gril)\M')
     or n ~ '\m(pareck[a-z0-9]*|klobas[a-z0-9]*|horal se syrem)\M'
     or n ~ '\m(losos[a-z0-9]*|pstruh[a-z0-9]*|tresk[a-z0-9]*|tunak[a-z0-9]*|sledov[a-z0-9]*)\M' then
    return 'food';
  end if;$old$;
  new_block text := $new$  if n ~ '\m(kedlub[a-z0-9]*|lilek)\M'
     or n ~ '\m(syrove platky|parenic[a-z0-9]*|syrar[a-z0-9]* vyber)\M'
     or (n ~ '\msyr[a-z0-9]*\M' and n ~ '\m(panev|gril)\M')
     or n ~ '\m(pareck[a-z0-9]*|klobas[a-z0-9]*|horal se syrem|masova tlacenka)\M'
     or n ~ '\m(losos[a-z0-9]*|pstruh[a-z0-9]*|tresk[a-z0-9]*|tunak[a-z0-9]*|sledov[a-z0-9]*)\M'
     or n ~ '\msladka bulka\M'
     or n ~ '\mcelozrnny zitny chleb\M'
     or (n ~ '\mzelenin[a-z0-9]*\M' and n ~ '\mpolevk[a-z0-9]*\M') then
    return 'food';
  end if;$new$;
begin
  d := pg_get_functiondef('public.resolve_public_filter_group(text,text,text)'::regprocedure);
  if position(old_block in d)=0 then
    raise exception 'strong food identity block not found';
  end if;
  d := replace(d,old_block,new_block);
  execute d;
end;
$migration$;

select private.refresh_public_offer_search_cache_if_dirty(true);
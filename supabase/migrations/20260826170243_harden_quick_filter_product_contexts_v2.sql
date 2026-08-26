set local statement_timeout = '90s';

do $migration$
declare
  d text;
  old_cold text := $old_cold$if not pet_context and not seasoning_context
     and s ~ '(^| )(sunk[a-z0-9]*|salam[a-z0-9]*|parek|parky|pareck[a-z0-9]*|klobas[a-z0-9]*|slanina|spekack[a-z0-9]*|tlacenk[a-z0-9]*|uzenin[a-z0-9]*|luncheon[a-z0-9]*)( |$)'
  then tags:=array_append(tags,'cold_cuts'); end if;$old_cold$;
  new_cold text := $new_cold$if not pet_context and not seasoning_context
     and (s ~ '(^| )(sunk[a-z0-9]*|salam[a-z0-9]*|parek|parky|pareck[a-z0-9]*|klobas[a-z0-9]*|slanina|spekack[a-z0-9]*|tlacenk[a-z0-9]*|uzenin[a-z0-9]*|luncheon[a-z0-9]*)( |$)'
          or s ~ '(^| )horal se syrem( |$)')
     and s !~ '(^| )(sunkovar|nuz|noze|krajec[a-z0-9]*)( |$)'
  then tags:=array_append(tags,'cold_cuts'); end if;$new_cold$;
  old_cheese_tail text := $old_cheese$    and not bread
    and s !~$old_cheese$;
  new_cheese_tail text := $new_cheese$    and not bread
    and s !~ '(^| )horal se syrem( |$)'
    and s !~$new_cheese$;
begin
  d := pg_get_functiondef('public.public_offer_semantic_tags(text)'::regprocedure);

  if position($old_beer$beer := s ~ '(^| )(pivo|pivni|lezak|radler|pils[a-z0-9]*|porter|stout)( |$)';$old_beer$ in d)=0 then
    raise exception 'beer identity pattern not found';
  end if;
  d := replace(
    d,
    $old_beer$beer := s ~ '(^| )(pivo|pivni|lezak|radler|pils[a-z0-9]*|porter|stout)( |$)';$old_beer$,
    $new_beer$beer := s ~ '(^| )(pivo|pivni|lezak|radler|pils[a-z0-9]*|porter|stout)( |$)'
    or s ~ '(^| )proud limetka( |$)';$new_beer$
  );

  if position($old_draught$if beer and s ~ '(^| )vycepn[a-z0-9]*( |$)' then tags:=array_append(tags,'beer_draught'); end if;$old_draught$ in d)=0 then
    raise exception 'beer draught pattern not found';
  end if;
  d := replace(
    d,
    $old_draught$if beer and s ~ '(^| )vycepn[a-z0-9]*( |$)' then tags:=array_append(tags,'beer_draught'); end if;$old_draught$,
    $new_draught$if beer and (s ~ '(^| )vycepn[a-z0-9]*( |$)' or s ~ '(^| )proud limetka( |$)') then tags:=array_append(tags,'beer_draught'); end if;$new_draught$
  );

  if position('fruit_processed := bread or meat_context' in d)=0 then
    raise exception 'fruit processed start not found';
  end if;
  d := replace(d,'fruit_processed := bread or meat_context','fruit_processed := bread or meat_context or pet_context');

  if position('  fruit := fruit_any and not fruit_processed;' in d)=0 then
    raise exception 'fruit assignment not found';
  end if;
  d := replace(
    d,
    '  fruit := fruit_any and not fruit_processed;',
    E'  fruit_processed := fruit_processed\n    or s ~ ''(^| )(neperliv[a-z0-9]*|perliv[a-z0-9]*|pet|proud|halenka|leginy|kosil[a-z0-9]*|kalhot[a-z0-9]*|ksiltovk[a-z0-9]*|vysivk[a-z0-9]*|hrack[a-z0-9]*|latexov[a-z0-9]*|krupav[a-z0-9]*)( |$)'';\n\n  fruit := fruit_any and not fruit_processed;'
  );

  if position('  veg := veg_any and not veg_processed;' in d)=0 then
    raise exception 'veg assignment not found';
  end if;
  d := replace(
    d,
    '  veg := veg_any and not veg_processed;',
    E'  veg_processed := veg_processed or pet_context\n    or s ~ ''(^| )(halenka|leginy|kosil[a-z0-9]*|kalhot[a-z0-9]*|ksiltovk[a-z0-9]*|vysivk[a-z0-9]*|hrack[a-z0-9]*|piskot[a-z0-9]*|suchar[a-z0-9]*|slimk[a-z0-9]*)( |$)'';\n\n  veg := veg_any and not veg_processed;'
  );

  if position(old_cheese_tail in d)=0 then
    raise exception 'cheese exclusion insertion point not found';
  end if;
  d := replace(d,old_cheese_tail,new_cheese_tail);

  if position(old_cold in d)=0 then
    raise exception 'cold cuts condition not found';
  end if;
  d := replace(d,old_cold,new_cold);

  execute d;
end;
$migration$;

select private.refresh_public_offer_search_cache_if_dirty(true);
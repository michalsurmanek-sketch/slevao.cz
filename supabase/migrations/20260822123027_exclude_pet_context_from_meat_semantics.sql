do $migration$
declare
  fn text := pg_get_functiondef('public.public_offer_semantic_tags(text)'::regprocedure);
begin
  if position('  prsa_meat boolean;' in fn)=0
     or position('  meat := s ~ ' in fn)=0
     or position('kralik[a-z0-9]*' in fn)=0 then
    raise exception 'semantic pet-context guard not found';
  end if;

  fn := replace(fn,
    '  prsa_meat boolean;',
    '  prsa_meat boolean;' || chr(10) || '  pet_context boolean;' || chr(10) || '  meat_alternative boolean;'
  );

  fn := replace(fn,
    chr(10) || chr(10) || '  meat := s ~ ',
    chr(10) || chr(10) ||
    '  pet_context := s ~ ''\m(akinu|dingo|dog snaq|prevital|vetamix|vitakraft|shinycat|huhubamboo|propesko|felix fantastic|whiskas|pedigree|purina)\M''' || chr(10) ||
    '    or s ~ ''\m(pro psy|pro kocky|pro psa|granule|pamlsk[a-z0-9]*|krmivo|kapsicky pro)\M'';' || chr(10) ||
    '  meat_alternative := s ~ ''\m(alternativ[a-z0-9]*|vegetari[a-z0-9]*|vegansk[a-z0-9]*|rostlinn[a-z0-9]*|veggie)\M''' || chr(10) ||
    '    and s ~ ''\mmasov[a-z0-9]*\M'';' || chr(10) || chr(10) ||
    '  meat := s ~ '
  );

  fn := replace(fn,'kralik[a-z0-9]*','kralic[a-z0-9]*');

  fn := replace(fn,
    '    or prsa_meat;' || chr(10) || chr(10) || '  chicken :=',
    '    or prsa_meat;' || chr(10) ||
    '  if pet_context or meat_alternative then meat := false; end if;' || chr(10) || chr(10) ||
    '  chicken :='
  );

  fn := replace(fn,
    '    or prsa_meat;' || chr(10) || chr(10) || '  fruit_any :=',
    '    or prsa_meat;' || chr(10) ||
    '  if pet_context or meat_alternative then chicken := false; end if;' || chr(10) || chr(10) ||
    '  fruit_any :='
  );

  fn := replace(fn,
    '  if s ~ ''\mkrkovic[a-z0-9]*\M'' then tags:=array_append(tags,''pork_neck''); end if;',
    '  if not pet_context and not meat_alternative and s ~ ''\mkrkovic[a-z0-9]*\M'' then tags:=array_append(tags,''pork_neck''); end if;'
  );
  fn := replace(fn,
    '  if s ~ ''\m(vepr[a-z0-9]*|krkovic[a-z0-9]*|kyta|plec|kotlet[a-z0-9]*|panenk[a-z0-9]*|bucek|koleno)\M'' then tags:=array_append(tags,''pork''); end if;',
    '  if not pet_context and not meat_alternative and s ~ ''\m(vepr[a-z0-9]*|krkovic[a-z0-9]*|kyta|plec|kotlet[a-z0-9]*|panenk[a-z0-9]*|bucek|koleno)\M'' then tags:=array_append(tags,''pork''); end if;'
  );
  fn := replace(fn,
    '  if s ~ ''\m(hovez[a-z0-9]*|svickov[a-z0-9]*|rosten[a-z0-9]*|steak[a-z0-9]*|gulasov[a-z0-9]*)\M'' then tags:=array_append(tags,''beef''); end if;',
    '  if not pet_context and not meat_alternative and s ~ ''\m(hovez[a-z0-9]*|svickov[a-z0-9]*|rosten[a-z0-9]*|steak[a-z0-9]*|gulasov[a-z0-9]*)\M'' then tags:=array_append(tags,''beef''); end if;'
  );

  execute fn;
end;
$migration$;
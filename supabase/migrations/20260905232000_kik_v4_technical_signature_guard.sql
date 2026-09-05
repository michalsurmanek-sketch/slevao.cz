do $migration$
declare
  fn text := pg_get_functiondef('public.publish_structured_store_offers(text,text,text,jsonb,integer,integer,text,text)'::regprocedure);
  old_guard text := E'if p_store_slug=''kik'' and p_adapter=''kik-publitas-text-v3'' then';
  new_guard text := E'if p_store_slug=''kik'' and p_adapter in (''kik-publitas-text-v3'',''kik-publitas-article-anchor-v4'') then';
begin
  if position('kik-publitas-article-anchor-v4' in fn) > 0 then
    return;
  end if;

  if position(old_guard in fn) = 0 then
    raise exception 'KiK technical signature guard insertion point not found';
  end if;

  fn := replace(fn, old_guard, new_guard);
  execute fn;
end;
$migration$;

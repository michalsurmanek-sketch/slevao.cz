do $$
declare
  v_signature regprocedure := 'public.get_public_offer_page_filtered(integer,integer,boolean,text,numeric,numeric,boolean,text,text,text,text,text,text)'::regprocedure;
  v_definition text;
  v_old text := E'total as (\n  select count(*)::bigint total_count from matched\n),';
  v_new text := E'total as materialized (\n  select count(*)::bigint total_count from matched\n),';
begin
  select pg_get_functiondef(v_signature) into v_definition;
  if strpos(v_definition, v_new) > 0 then
    return;
  end if;
  if strpos(v_definition, v_old) = 0 then
    raise exception 'Expected total CTE was not found in get_public_offer_page_filtered';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$$;

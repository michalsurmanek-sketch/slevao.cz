do $migration$
declare
  v_offer_def text;
  v_query_def text;
  v_processed_old text := $old$  fruit_processed := fruit_processed
    or s ~ '(^| )(neperliv[a-z0-9]*|perliv[a-z0-9]*|pet|proud|halenka|leginy|kosil[a-z0-9]*|kalhot[a-z0-9]*|ksiltovk[a-z0-9]*|vysivk[a-z0-9]*|hrack[a-z0-9]*|latexov[a-z0-9]*|krupav[a-z0-9]*)( |$)';$old$;
  v_processed_new text := $new$  fruit_processed := fruit_processed
    or s ~ '(^| )(neperliv[a-z0-9]*|perliv[a-z0-9]*|pet|proud|halenka|leginy|kosil[a-z0-9]*|kalhot[a-z0-9]*|ksiltovk[a-z0-9]*|vysivk[a-z0-9]*|hrack[a-z0-9]*|latexov[a-z0-9]*|krupav[a-z0-9]*)( |$)'
    or s ~ '(^| )(chips[a-z0-9]*|sorbet[a-z0-9]*)( |$)';$new$;
  v_mango_offer_old text := $old$  if fruit and s ~ '(^| )banan[a-z0-9]*( |$)' then tags:=array_append(tags,'bananas'); end if;$old$;
  v_mango_offer_new text := $new$  if fruit and s ~ '(^| )banan[a-z0-9]*( |$)' then tags:=array_append(tags,'bananas'); end if;
  if fruit and s ~ '(^| )mango( |$)' then tags:=array_append(tags,'mango'); end if;$new$;
  v_mango_query_old text := $old$  when 'banany' then 'bananas'$old$;
  v_mango_query_new text := $new$  when 'banany' then 'bananas'
  when 'mango' then 'mango'$new$;
begin
  select pg_get_functiondef(p.oid)
    into v_offer_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'public_offer_semantic_tags'
    and pg_get_function_identity_arguments(p.oid) = 'p_search text';

  if v_offer_def is null then
    raise exception 'public.public_offer_semantic_tags(text) is missing';
  end if;

  if position(v_processed_new in v_offer_def) = 0 then
    if position(v_processed_old in v_offer_def) = 0 then
      raise exception 'public_offer_semantic_tags processed-fruit anchor drifted';
    end if;
    v_offer_def := replace(v_offer_def, v_processed_old, v_processed_new);
  end if;

  if position(v_mango_offer_new in v_offer_def) = 0 then
    if position(v_mango_offer_old in v_offer_def) = 0 then
      raise exception 'public_offer_semantic_tags mango anchor drifted';
    end if;
    v_offer_def := replace(v_offer_def, v_mango_offer_old, v_mango_offer_new);
  end if;

  execute v_offer_def;

  select pg_get_functiondef(p.oid)
    into v_query_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'public_semantic_query_tag'
    and pg_get_function_identity_arguments(p.oid) = 'p_query text';

  if v_query_def is null then
    raise exception 'public.public_semantic_query_tag(text) is missing';
  end if;

  if position(v_mango_query_new in v_query_def) = 0 then
    if position(v_mango_query_old in v_query_def) = 0 then
      raise exception 'public_semantic_query_tag mango anchor drifted';
    end if;
    v_query_def := replace(v_query_def, v_mango_query_old, v_mango_query_new);
  end if;

  execute v_query_def;

  if public.public_offer_semantic_tags('Farmland Banánové chipsy') @> array['fruit_fresh']::text[] then
    raise exception 'banana chips still classified as fruit_fresh';
  end if;

  if public.public_offer_semantic_tags('BALLINO Sorbet Mango/ Lesní směs') && array['fruit_fresh','fruit_exotic','mango']::text[] then
    raise exception 'mango sorbet still classified as fresh/exotic mango';
  end if;

  if not (public.public_offer_semantic_tags('Banány') @> array['fruit_fresh','bananas']::text[]) then
    raise exception 'fresh bananas lost fruit semantics';
  end if;

  if not (public.public_offer_semantic_tags('Mango') @> array['fruit_fresh','fruit_exotic','mango']::text[]) then
    raise exception 'fresh mango semantic tags are incomplete';
  end if;

  if public.public_semantic_query_tag('mango') is distinct from 'mango' then
    raise exception 'mango query is not mapped to exact semantic tag';
  end if;
end;
$migration$;

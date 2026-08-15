-- PENNY publishes two complementary official sources:
-- 1) a small set of precise HTML promotion cards and
-- 2) the complete multi-page PDF leaflet.
--
-- The HTML publisher must only retire its own previous HTML offers. It must
-- never expire or ignore offers/imports coming from the complete PDF leaflet.

do $migration$
declare
  v_function_sql text;
  v_original text;
begin
  select pg_get_functiondef(
    'public.publish_penny_structured_html(text,bigint)'::regprocedure
  ) into v_function_sql;

  v_original := v_function_sql;

  v_function_sql := replace(
    v_function_sql,
    $old$where store_id=v_store_id and status='published' and not(id=any(v_offer_ids))$old$,
    $new$where store_id=v_store_id
      and status='published'
      and metadata->>'adapter'='penny-structured-html-v1'
      and not(id=any(v_offer_ids))$new$
  );

  v_function_sql := replace(
    v_function_sql,
    $old$and coalesce(metadata->>'adapter','') in ('store:penny-flippingbook','generic');$old$,
    $new$and coalesce(metadata->>'adapter','')='penny-structured-html-v1';$new$
  );

  if v_function_sql = v_original then
    raise exception 'PENNY publisher patch did not match the installed function.';
  end if;

  if position(
    $check$metadata->>'adapter'='penny-structured-html-v1'$check$
    in v_function_sql
  ) = 0 then
    raise exception 'PENNY offer source guard was not installed.';
  end if;

  execute v_function_sql;
end;
$migration$;

comment on function public.publish_penny_structured_html(text,bigint) is
  'Publishes precise PENNY HTML offers without replacing complete PDF leaflet offers.';

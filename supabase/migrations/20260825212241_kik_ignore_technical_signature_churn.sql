create or replace function private.kik_structured_rows_match_published_set(
  p_rows jsonb,
  p_store_id uuid,
  p_adapter text,
  p_count integer
)
returns boolean
language sql
stable
set search_path = 'public', 'private', 'pg_temp'
as $function$
with expected as materialized (
  select
    trim(coalesce(x->>'external_id','')) as external_id,
    trim(coalesce(x->>'title','')) as title,
    trim(coalesce(x->>'normalized_title','')) as normalized_title,
    nullif(x->>'price','')::numeric as price,
    nullif(x->>'old_price','')::numeric as old_price,
    nullif(x->>'valid_from','')::date as valid_from,
    nullif(x->>'valid_to','')::date as valid_to,
    nullif(trim(coalesce(x->>'source_url','')),'') as source_url,
    greatest(0.50,least(1,coalesce(nullif(x->>'confidence','')::numeric,0.95))) as confidence
  from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) x
), published_count as (
  select count(*)::integer as n
  from public.offers o
  where o.store_id=p_store_id
    and o.status='published'
), exact_matches as (
  select count(*)::integer as n
  from expected e
  join public.offers o
    on o.store_id=p_store_id
   and o.status='published'
   and o.external_id=e.external_id
   and o.title=e.title
   and o.normalized_title=e.normalized_title
   and o.price=e.price
   and o.old_price is not distinct from case when e.old_price is not null and e.old_price>e.price then e.old_price else null end
   and o.valid_from=e.valid_from
   and o.valid_to=e.valid_to
   and o.source_url is not distinct from e.source_url
   and o.is_verified=(e.confidence>=0.90)
   and o.confidence_score=e.confidence
   and coalesce(o.metadata->>'adapter','')=p_adapter
)
select jsonb_array_length(coalesce(p_rows,'[]'::jsonb))=p_count
   and coalesce((select n from published_count),0)=p_count
   and coalesce((select n from exact_matches),0)=p_count;
$function$;

revoke all on function private.kik_structured_rows_match_published_set(jsonb,uuid,text,integer) from public, anon, authenticated;

do $migration$
declare
  fn text := pg_get_functiondef('public.publish_structured_store_offers(text,text,text,jsonb,integer,integer,text,text)'::regprocedure);
  needle text := E'  select id into v_existing_import from public.leaflet_imports where source_hash=p_adapter||\':\'||p_signature limit 1;\n';
  patch text := $patch$  if p_store_slug='kik' and p_adapter='kik-publitas-text-v3' then
    select li.id into v_import_id
    from public.leaflet_imports li
    where li.store_id=v_store_id
      and li.status='published'
      and coalesce(li.metadata->>'adapter','')=p_adapter
    order by li.updated_at desc nulls last,li.created_at desc
    limit 1;

    if v_import_id is not null
       and private.kik_structured_rows_match_published_set(p_rows,v_store_id,p_adapter,v_input_count) then
      select min((x->>'valid_from')::date),max((x->>'valid_to')::date)
        into v_from,v_to
      from jsonb_array_elements(p_rows) x;

      update public.store_product_sync_state
         set last_run_at=v_now,
             last_success_at=v_now,
             last_source_signature=p_signature,
             source_fingerprint=p_signature,
             last_offer_count=v_input_count,
             expected_offer_count=v_input_count,
             last_published_count=v_input_count,
             last_valid_from=v_from,
             last_valid_to=v_to,
             parser_version=v_parser,
             adapter_name=p_adapter,
             adapter_version=v_parser,
             source_type='official-structured',
             source_category='current-leaflet',
             last_error=null,
             last_parser_error=null,
             health_status='ok',
             health_reason=format('KiK: produktová sada beze změny; zachováno %s ověřených nabídek.',v_input_count),
             is_running=false,
             run_started_at=null,
             updated_at=v_now,
             last_import_id=v_import_id
       where store_id=v_store_id;

      update public.leaflet_sources
         set last_checked_at=v_now,
             last_success_at=v_now,
             last_error=null,
             last_strategy_used='official_structured_products',
             last_strategy_success_at=v_now
       where id=v_source_id;

      return jsonb_build_object(
        'ok',true,
        'no_changes',true,
        'technical_signature_ignored',true,
        'store_slug',p_store_slug,
        'import_id',v_import_id,
        'input',v_input_count,
        'published',v_input_count,
        'skipped',0,
        'expired',0,
        'signature',p_signature,
        'product_identity','structured-store-external-v2'
      );
    end if;
  end if;

$patch$;
begin
  if position('kik_structured_rows_match_published_set' in fn)>0 then
    raise exception 'KiK technical signature guard is already installed';
  end if;
  if position(needle in fn)=0 then
    raise exception 'Structured publisher KiK insertion point not found';
  end if;
  fn := replace(fn, needle, patch || needle);
  execute fn;
end;
$migration$;

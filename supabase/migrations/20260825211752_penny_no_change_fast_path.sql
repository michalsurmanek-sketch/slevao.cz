create or replace function private.penny_structured_html_matches_published_set(
  p_html text,
  p_store_id uuid,
  p_signature text,
  p_count integer,
  p_from date,
  p_to date
)
returns boolean
language sql
stable
set search_path = 'public', 'private', 'pg_temp'
as $function$
with parsed as materialized (
  select * from public.parse_penny_structured_html(p_html)
), campaign as (
  select count(*)::integer as offer_count
  from public.offers o
  where o.store_id=p_store_id
    and o.status='published'
    and o.is_verified=true
    and coalesce(o.metadata->>'adapter','')='penny-structured-html-v1'
    and o.valid_from<=p_to
    and o.valid_to>=p_from
), exact_matches as (
  select count(*)::integer as match_count
  from parsed p
  join public.offers o
    on o.store_id=p_store_id
   and o.external_id='penny-web:'||p.external_id
   and o.valid_from=p.valid_from
   and o.valid_to=p.valid_to
   and o.price=p.price
   and o.old_price is not distinct from p.old_price
   and o.status='published'
   and o.is_verified=true
   and coalesce(o.metadata->>'source_signature','')=p_signature
)
select coalesce((select offer_count from campaign),0)=p_count
   and coalesce((select match_count from exact_matches),0)=p_count;
$function$;

revoke all on function private.penny_structured_html_matches_published_set(text,uuid,text,integer,date,date) from public, anon, authenticated;

do $migration$
declare
  fn text := pg_get_functiondef('public.publish_penny_structured_html(text,bigint)'::regprocedure);
  needle text := E'  if v_existing_import is null then\n';
  patch text := $patch$  if v_existing_import is not null
     and exists(
       select 1 from public.leaflet_imports li
       where li.id=v_existing_import
         and li.status='published'
         and li.product_count=v_count
         and li.detected_valid_from=v_from
         and li.detected_valid_to=v_to
     )
     and exists(select 1 from public.store_product_sync_state ss where ss.store_id=v_store_id)
     and private.penny_structured_html_matches_published_set(
       p_html,v_store_id,v_signature,v_count,v_from,v_to
     ) then
    update public.store_product_sync_state
       set last_run_at=v_now,
           last_success_at=v_now,
           last_source_signature=v_signature,
           last_offer_count=v_count,
           last_error=null,
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'request_id',p_request_id,
             'prefetched_next_day',v_from>v_today,
             'no_changes',true
           ),
           updated_at=v_now,
           last_valid_from=v_from,
           last_valid_to=v_to,
           is_running=false,
           run_started_at=null,
           parser_version='penny-structured-html-v1',
           source_type='official-html-products',
           expected_offer_count=v_count,
           coverage_scope='national',
           source_category='current-offers',
           last_http_status=200,
           last_html_length=length(p_html),
           last_parser_error=null,
           last_product_candidates=v_count,
           last_published_count=v_count,
           last_import_id=v_existing_import,
           adapter_name='penny-structured-html',
           adapter_version='penny-structured-html-v1',
           source_fingerprint=v_signature,
           health_reason=format('PENNY: oficiální HTML beze změny; zachováno %s přesných nabídek%s.',v_count,case when v_from>v_today then ' pro zítřek' else '' end),
           health_status='ok',
           product_set_hash=v_signature
     where store_id=v_store_id;

    update public.leaflet_sources
       set last_checked_at=v_now,
           last_success_at=v_now,
           last_error=null,
           last_strategy_used='official_html_product_cards',
           last_strategy_success_at=v_now
     where id=v_source_id;

    return jsonb_build_object(
      'ok',true,
      'no_changes',true,
      'import_id',v_existing_import,
      'parsed',v_count,
      'published',v_count,
      'expired',0,
      'valid_from',v_from,
      'valid_to',v_to,
      'prefetched_next_day',v_from>v_today,
      'signature',v_signature
    );
  end if;

$patch$;
begin
  if position('penny_structured_html_matches_published_set' in fn)>0 then
    raise exception 'PENNY no-change fast path is already installed';
  end if;
  if position(needle in fn)=0 then
    raise exception 'PENNY publisher insertion point not found';
  end if;
  fn := replace(fn, needle, patch || needle);
  execute fn;
end;
$migration$;

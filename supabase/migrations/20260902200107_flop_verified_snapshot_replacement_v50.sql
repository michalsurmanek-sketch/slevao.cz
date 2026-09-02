create or replace function private.finalize_flop_verified_snapshot_v50(p_import_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
set statement_timeout to '30s'
as $function$
declare
  v_import record;
  v_store_id uuid;
  v_candidate_count integer;
  v_distinct_products integer;
  v_offer_count integer;
  v_expired integer := 0;
  v_now timestamptz := now();
begin
  select li.*,s.id as flop_store_id
    into v_import
  from public.leaflet_imports li
  join public.stores s on s.id=li.store_id and s.slug='flop'
  where li.id=p_import_id;

  if not found then
    return jsonb_build_object('ok',false,'reason','not_flop_import');
  end if;

  if v_import.status<>'published'
     or coalesce(v_import.metadata->>'payload_contract',v_import.metadata->>'full_payload_hash_version','')<>'flop-pdf-spatial-safe-v4' then
    return jsonb_build_object('ok',false,'reason','not_published_v4');
  end if;

  v_store_id:=v_import.flop_store_id;
  v_candidate_count:=coalesce(v_import.product_count,0);

  select count(distinct lii.product_id)::integer
    into v_distinct_products
  from public.leaflet_import_items lii
  where lii.import_id=p_import_id
    and lii.product_id is not null;

  select count(distinct o.product_id)::integer
    into v_offer_count
  from public.offers o
  where o.store_id=v_store_id
    and o.status='published'
    and o.is_verified=true
    and coalesce(o.store_location_name,'')='FLOP TOP'
    and o.metadata->>'import_id'=p_import_id::text
    and o.valid_from<=coalesce(v_import.detected_valid_to,current_date)
    and o.valid_to>=coalesce(v_import.detected_valid_from,current_date);

  if v_candidate_count<25 or v_distinct_products<25 or v_offer_count<>v_distinct_products then
    return jsonb_build_object(
      'ok',false,
      'reason','snapshot_not_fully_materialized',
      'candidate_count',v_candidate_count,
      'distinct_products',v_distinct_products,
      'public_products',v_offer_count
    );
  end if;

  update public.offers o
     set status='expired',updated_at=v_now
   where o.store_id=v_store_id
     and o.status='published'
     and coalesce(o.store_location_name,'')='FLOP TOP'
     and o.valid_from=coalesce(v_import.detected_valid_from,o.valid_from)
     and o.valid_to=coalesce(v_import.detected_valid_to,o.valid_to)
     and coalesce(o.metadata->>'import_id','')<>p_import_id::text;
  get diagnostics v_expired=row_count;

  update public.store_product_sync_state
     set last_run_at=v_now,
         last_success_at=v_now,
         last_source_signature=v_import.source_hash,
         last_offer_count=v_offer_count,
         last_error=null,
         last_parser_error=null,
         last_valid_from=v_import.detected_valid_from,
         last_valid_to=v_import.detected_valid_to,
         is_running=false,
         run_started_at=null,
         parser_version='flop-pdf-spatial-unit-price-v4',
         source_type='official-pdf-spatial',
         expected_offer_count=v_candidate_count,
         coverage_scope='store',
         source_category='current-offers',
         last_http_status=200,
         last_product_candidates=v_candidate_count,
         last_published_count=v_offer_count,
         last_import_id=p_import_id,
         adapter_name='sync-flop-pdf-products',
         adapter_version='v4',
         source_fingerprint=v_import.source_hash,
         health_status='ok',
         health_reason=format('Publikováno %s ověřených FLOP TOP produktových identit z %s bezpečných PDF položek pro %s až %s.',v_offer_count,v_candidate_count,v_import.detected_valid_from,v_import.detected_valid_to),
         product_set_hash=v_import.source_hash,
         updated_at=v_now
   where store_id=v_store_id;

  return jsonb_build_object(
    'ok',true,
    'import_id',p_import_id,
    'candidate_count',v_candidate_count,
    'distinct_products',v_distinct_products,
    'public_products',v_offer_count,
    'expired_superseded_offers',v_expired
  );
end;
$function$;

revoke all on function private.finalize_flop_verified_snapshot_v50(uuid) from public,anon,authenticated;
grant execute on function private.finalize_flop_verified_snapshot_v50(uuid) to postgres,service_role;

create or replace function private.finalize_latest_flop_verified_snapshot_v50()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
set statement_timeout to '30s'
as $function$
declare
  v_import_id uuid;
begin
  select li.id into v_import_id
  from public.leaflet_imports li
  join public.stores s on s.id=li.store_id and s.slug='flop'
  where li.status='published'
    and coalesce(li.metadata->>'payload_contract',li.metadata->>'full_payload_hash_version','')='flop-pdf-spatial-safe-v4'
    and li.detected_valid_to >= (now() at time zone 'Europe/Prague')::date
  order by li.updated_at desc nulls last,li.created_at desc
  limit 1;

  if v_import_id is null then
    return jsonb_build_object('ok',false,'reason','no_current_v4_import');
  end if;

  return private.finalize_flop_verified_snapshot_v50(v_import_id);
end;
$function$;

revoke all on function private.finalize_latest_flop_verified_snapshot_v50() from public,anon,authenticated;
grant execute on function private.finalize_latest_flop_verified_snapshot_v50() to postgres,service_role;

do $block$
declare v_jobid bigint;
begin
  for v_jobid in select jobid from cron.job where jobname='finalize-flop-current-snapshot' loop
    perform cron.unschedule(v_jobid);
  end loop;
  perform cron.schedule('finalize-flop-current-snapshot','23,53 * * * *','select private.finalize_latest_flop_verified_snapshot_v50();');
end;
$block$;

select private.finalize_flop_verified_snapshot_v50('ec817345-2c6e-4f22-971a-25a3b2d2a49a'::uuid);
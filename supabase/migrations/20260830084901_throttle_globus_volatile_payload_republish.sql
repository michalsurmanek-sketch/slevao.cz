do $$
declare
  v_oid oid;
  v_def text;
  v_new text;
  v_store_id uuid;
  v_signature text;
begin
  select p.oid
    into v_oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='publish_globus_olomouc_offers'
  limit 1;

  if v_oid is null then
    raise exception 'publish_globus_olomouc_offers nebyla nalezena';
  end if;

  v_def := pg_get_functiondef(v_oid);
  v_new := v_def;

  v_new := replace(
    v_new,
    $old$and li.metadata ->> 'full_payload_hash_version' = 'globus-full-payload-v1'
    and li.metadata ->> 'full_payload_sha256' = v_payload_hash$old$,
    $new$and li.metadata ->> 'full_payload_hash_version' = 'globus-full-payload-v1'
    and (
      li.metadata ->> 'full_payload_sha256' = v_payload_hash
      or coalesce(nullif(li.metadata ->> 'full_payload_synced_at', '')::timestamptz, '-infinity'::timestamptz) > v_now - interval '2 hours'
    )$new$
  );

  if v_new = v_def then
    raise exception 'Globus fast-path match block nebyl nahrazen';
  end if;
  v_def := v_new;

  v_new := replace(
    v_new,
    $old$'full_payload_hash_version', 'globus-full-payload-v1',
               'full_payload_sha256', v_payload_hash,
               'api_reported_total_count'$old$,
    $new$'full_payload_hash_version', 'globus-full-payload-v1',
               'last_observed_payload_sha256', v_payload_hash,
               'api_reported_total_count'$new$
  );

  if v_new = v_def then
    raise exception 'Globus fast-path metadata block nebyl nahrazen';
  end if;
  v_def := v_new;

  v_new := replace(
    v_new,
    $old$'full_payload_hash_version', 'globus-full-payload-v1',
             'full_payload_sha256', v_payload_hash
           )$old$,
    $new$'full_payload_hash_version', 'globus-full-payload-v1',
             'full_payload_sha256', v_payload_hash,
             'last_observed_payload_sha256', v_payload_hash,
             'full_payload_synced_at', clock_timestamp()
           )$new$
  );

  if v_new = v_def then
    raise exception 'Globus full-publish metadata block nebyl nahrazen';
  end if;

  execute v_new;

  select id into v_store_id from public.stores where slug='globus' limit 1;
  select last_source_signature into v_signature
  from public.store_product_sync_state
  where store_id=v_store_id;

  update public.leaflet_imports li
     set metadata=coalesce(li.metadata,'{}'::jsonb) || jsonb_build_object(
           'full_payload_synced_at',coalesce(nullif(li.metadata->>'full_payload_synced_at','')::timestamptz,li.updated_at),
           'last_observed_payload_sha256',coalesce(li.metadata->>'last_observed_payload_sha256',li.metadata->>'full_payload_sha256')
         )
   where li.store_id=v_store_id
     and li.status='published'
     and li.source_hash='globus-action-products-api-v1:'||v_signature
     and li.metadata->>'full_payload_hash_version'='globus-full-payload-v1';
end $$;

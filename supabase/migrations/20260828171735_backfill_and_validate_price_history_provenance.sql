update public.price_history
   set metadata = metadata || jsonb_build_object('provenance', 'legacy_backfill_unknown_origin')
 where offer_id is null
   and nullif(btrim(source_url), '') is null
   and coalesce(nullif(btrim(metadata->>'provenance'), ''), '') = '';

alter table public.price_history
  validate constraint price_history_direct_insert_provenance;

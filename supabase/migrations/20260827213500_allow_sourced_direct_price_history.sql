alter table public.price_history
  drop constraint if exists price_history_direct_insert_provenance;

alter table public.price_history
  add constraint price_history_direct_insert_provenance
  check (
    offer_id is not null
    or nullif(btrim(source_url), '') is not null
    or coalesce(nullif(btrim(metadata ->> 'provenance'), ''), '') <> ''
  ) not valid;

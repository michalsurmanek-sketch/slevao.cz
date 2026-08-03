update public.leaflet_imports li
set status = 'ignored',
    error_message = null,
    finished_at = coalesce(finished_at, now()),
    metadata = jsonb_set(
      jsonb_set(coalesce(metadata, '{}'::jsonb), '{legacy_size_failure_closed}', 'true'::jsonb, true),
      '{legacy_size_failure_closed_at}',
      to_jsonb(now()::text),
      true
    )
where li.source_id in (
  select ls.id
  from public.leaflet_sources ls
  join public.stores s on s.id = ls.store_id
  where s.slug = 'kaufland'
    and ls.source_url = 'https://prodejny.kaufland.cz/letak.html'
)
  and li.status = 'failed'
  and li.error_message ilike '%maximum allowed size%';

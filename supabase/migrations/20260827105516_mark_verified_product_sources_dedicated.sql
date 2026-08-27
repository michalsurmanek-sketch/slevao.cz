-- Sources below are owned by their verified structured-product pipelines.
-- The generic leaflet crawler cannot extract a useful PDF/document from them and
-- was only overwriting otherwise healthy source state with a false generic error.
with dedicated_sources(slug, adapter_key) as (
  values
    ('asko', 'asko-official-clearance-html-v2'),
    ('auto-kelly', 'auto-kelly-marketing-deals-v1'),
    ('ca', 'ca-official-sale-v1'),
    ('cropp', 'cropp-official-clearance-v1'),
    ('dek', 'dek-official-action-html-v1'),
    ('house', 'house-official-clearance-v1'),
    ('ikea', 'ikea-official-lower-price-v1'),
    ('petcenter', 'petcenter-official-clearance-html-v1'),
    ('reserved', 'reserved-official-clearance-v1'),
    ('rohlik', 'rohlik-price-hits-html-v1'),
    ('sinsay', 'sinsay-official-clearance-v1'),
    ('takko', 'takko-official-sale-html-v2')
)
update public.leaflet_sources ls
set automation_mode = 'dedicated',
    last_error = case
      when coalesce(ls.last_error, '') ilike 'Adaptér generic %' then null
      else ls.last_error
    end,
    updated_at = now()
from public.stores s
join dedicated_sources d on d.slug = s.slug
where ls.store_id = s.id
  and ls.is_active is true
  and ls.automation_mode = 'automatic'
  and ls.adapter_key = d.adapter_key;

-- Replay-safe cleanup: if an old generic job is still in flight on another
-- environment, archive only that generic job. Dedicated imports are untouched.
with dedicated_stores(slug) as (
  values
    ('asko'), ('auto-kelly'), ('ca'), ('cropp'), ('dek'), ('house'),
    ('ikea'), ('petcenter'), ('reserved'), ('rohlik'), ('sinsay'), ('takko')
)
update public.leaflet_imports li
set status = 'ignored',
    error_message = 'Nahrazen dedikovaným ověřeným produktovým tokem; generic leaflet discovery není vlastníkem zdroje.',
    finished_at = coalesce(li.finished_at, now()),
    metadata = coalesce(li.metadata, '{}'::jsonb) || jsonb_build_object(
      'archive_reason', 'superseded_by_dedicated_product_pipeline',
      'archived_at', now()
    ),
    updated_at = now()
from public.stores s
join dedicated_stores d on d.slug = s.slug
where li.store_id = s.id
  and li.status in ('review', 'queued', 'downloading', 'processing', 'publishing')
  and coalesce(li.metadata->>'adapter', 'generic') = 'generic';

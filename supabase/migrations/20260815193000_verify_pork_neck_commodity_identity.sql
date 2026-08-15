-- Fresh weighted meat has no retail EAN; use its verified commodity identity instead.
update public.products
set
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'identity_type', 'verified_commodity',
    'identity_key', 'meat:pork:neck:bone-in:per-kg',
    'identity_verified_at', now()
  ),
  filter_group = 'meat',
  filter_tags = array['pork','neck','bone-in','fresh','weighted'],
  content_form = 'fresh_weighted',
  classification_confidence = 1,
  classification_source = 'manual_verified',
  classified_at = now(),
  updated_at = now()
where id = 'e35e4519-b207-4da2-8b7b-02936c3e774f';

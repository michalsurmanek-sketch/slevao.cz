update public.products p
set metadata=coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
      'filter_group_source','auto_classifier',
      'legacy_reclassification_reason','yogurt-before-coffee-v82',
      'legacy_reclassification_at',now()
    ),
    updated_at=now()
where p.is_active=true
  and p.filter_group='drinks'
  and coalesce(p.metadata->>'filter_group_source','')<>'explicit'
  and public.normalize_text(p.name) ~ '(^| )jogurt( |$)'
  and lower(btrim(coalesce(p.quantity_text,''))) ~ '^(cca[[:space:]]+)?[0-9]+([,.][0-9]+)?([[:space:]]*[-–][[:space:]]*[0-9]+([,.][0-9]+)?)?[[:space:]]*(g|kg)$';
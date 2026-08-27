update public.offers
set status = 'expired',
    metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'quarantined_reason','lidl_verified_parser_heading_or_duplicate',
      'quarantined_at',now()
    ),
    updated_at = now()
where store_id = (select id from public.stores where slug='lidl')
  and status='published'
  and metadata->>'adapter'='lidl-verified-pdf-text-v2'
  and title in (
    '**doporučená prodejní cena výrobce ORION Studentská pečeť',
    'Jakub Přibyl, sommelier Lidlu',
    'Od pondělí 24. 8. do 26. 8.',
    'Premiéra v Lidlu'
  );

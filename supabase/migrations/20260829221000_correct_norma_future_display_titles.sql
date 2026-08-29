-- Verified against official NORMA week 36 PDF token layout.
-- Keep leaflet_import_items unchanged so the deterministic payload hash remains stable.

update public.products
set name='Camasella Primitivo Puglia IGT · 0,75 l',
    normalized_name=public.normalize_product_name('Camasella Primitivo Puglia IGT · 0,75 l'),
    brand='Camasella',
    metadata=(coalesce(metadata,'{}'::jsonb) - 'filter_group_classifier_checked_at' - 'filter_group_classifier_checked_version') || jsonb_build_object(
      'title_corrected_from_norma_pdf',true,
      'title_correction_source','official_norma_pdf_tokens',
      'title_correction_import_id','fb6e10ce-3241-483c-ad02-da63c453a31e'
    )
where id='0df12136-8f96-4dda-82b2-51111d5be694'::uuid;

update public.offers
set title='Camasella Primitivo Puglia IGT · 0,75 l',
    normalized_title=public.normalize_product_name('Camasella Primitivo Puglia IGT · 0,75 l'),
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'title_corrected_from_norma_pdf',true,
      'title_correction_source','official_norma_pdf_tokens',
      'title_correction_import_id','fb6e10ce-3241-483c-ad02-da63c453a31e'
    )
where id='335bdc16-07fb-406e-a5d4-320a6ec663a9'::uuid;

insert into public.product_aliases(product_id,alias,normalized_alias,brand,quantity_text,source_store_id,confidence)
values(
  '0df12136-8f96-4dda-82b2-51111d5be694'::uuid,
  'Camasella Primitivo Puglia IGT · 0,75 l',
  public.normalize_product_name('Camasella Primitivo Puglia IGT · 0,75 l'),
  'Camasella','750ml','3d47a436-885e-4843-8c99-51b41ff26dc7'::uuid,1.0
)
on conflict (product_id,normalized_alias) do update
set alias=excluded.alias,
    brand=excluded.brand,
    quantity_text=excluded.quantity_text,
    source_store_id=excluded.source_store_id,
    confidence=greatest(public.product_aliases.confidence,excluded.confidence);

update public.products
set name='Heffron Original dárkové balení · 0,5 l',
    normalized_name=public.normalize_product_name('Heffron Original dárkové balení · 0,5 l'),
    brand='Heffron',
    metadata=(coalesce(metadata,'{}'::jsonb) - 'filter_group_classifier_checked_at' - 'filter_group_classifier_checked_version') || jsonb_build_object(
      'title_corrected_from_norma_pdf',true,
      'title_correction_source','official_norma_pdf_tokens',
      'title_correction_import_id','fb6e10ce-3241-483c-ad02-da63c453a31e'
    )
where id='250eb7b2-3915-49c7-b68b-f893e2bc0cfe'::uuid;

update public.offers
set title='Heffron Original dárkové balení · 0,5 l',
    normalized_title=public.normalize_product_name('Heffron Original dárkové balení · 0,5 l'),
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'title_corrected_from_norma_pdf',true,
      'title_correction_source','official_norma_pdf_tokens',
      'title_correction_import_id','fb6e10ce-3241-483c-ad02-da63c453a31e'
    )
where id='9335dca0-ca96-4b47-b4bf-d37560026bb2'::uuid;

insert into public.product_aliases(product_id,alias,normalized_alias,brand,quantity_text,source_store_id,confidence)
values(
  '250eb7b2-3915-49c7-b68b-f893e2bc0cfe'::uuid,
  'Heffron Original dárkové balení · 0,5 l',
  public.normalize_product_name('Heffron Original dárkové balení · 0,5 l'),
  'Heffron','500ml','3d47a436-885e-4843-8c99-51b41ff26dc7'::uuid,1.0
)
on conflict (product_id,normalized_alias) do update
set alias=excluded.alias,
    brand=excluded.brand,
    quantity_text=excluded.quantity_text,
    source_store_id=excluded.source_store_id,
    confidence=greatest(public.product_aliases.confidence,excluded.confidence);

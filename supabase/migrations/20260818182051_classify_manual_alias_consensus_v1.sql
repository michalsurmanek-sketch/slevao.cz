do $$
declare
  fashion_category uuid;
  home_category uuid;
begin
  select id into fashion_category from categories where slug='moda' limit 1;
  select id into home_category from categories where slug='domacnost' limit 1;
  if fashion_category is null or home_category is null then
    raise exception 'Required canonical categories are missing';
  end if;

  update products
     set category_id=fashion_category,
         filter_group='fashion',
         filter_tags=array['moda'],
         classification_confidence=0.99,
         classification_source='manual-alias-consensus-v1',
         classified_at=now(),
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('classification_reason','manually-reviewed-high-confidence-alias-consensus')
   where category_id is null
     and is_active is true
     and quantity_text='cena za 1 kus'
     and name in (
       'CRIVIT Funkční triko S - L',
       'NIKE Funkční kraťasy M - XXL',
       'NIKE Funkční kraťasy S - XL',
       'NIKE Funkční triko M - XXL',
       'NIKE Triko M - XXL',
       'NIKE Triko S - XL',
       'PARKSIDE Pracovní kraťasy 48 - 58'
     );

  update products
     set category_id=home_category,
         filter_group='home',
         filter_tags=array['domacnost'],
         classification_confidence=0.99,
         classification_source='manual-alias-consensus-v1',
         classified_at=now(),
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('classification_reason','manually-reviewed-high-confidence-alias-consensus')
   where category_id is null
     and is_active is true
     and name='Polštář z umělého vlákna 70x80 KLEINEGGA'
     and brand='JYSK'
     and quantity_text='ks';
end $$;

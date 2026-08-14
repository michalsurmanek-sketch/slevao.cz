do $$
declare
  v_store_id uuid;
begin
  select id into v_store_id from public.stores where slug='dr-max';
  if v_store_id is null then return; end if;

  with map(old_title, price, new_title, qty, old_price, url, ean) as (values
    ('ALFASILVER sprej · 50 ml'::text,219::numeric,'ALFASILVER sprej · 50 ml','50 ml',null::numeric,'https://www.drmax.cz/alfasilver-sprej-50-ml','8017703744041'),
    ('Atix sprej pro bezpečné odstraňování klíšťat · 9 ml + pinzeta',269,'Atix sprej pro bezpečné odstraňování klíšťat · 9 ml + pinzeta','9 ml + pinzeta',null,'https://www.drmax.cz/atix-sada-pro-bezpecne-odstranovani-klistat-sprej-9-ml-pinzeta','5902596718282'),
    ('DERMATOP SILVERSPRAY · 50 ml',199,'DERMATOP SILVERSPRAY · 50 ml','50 ml',268,'https://www.drmax.cz/dermatop-silverspray-50-ml','8055267240241'),
    ('Fenistil 1 mg/g gel',299,'Fenistil 1 mg/g gel','50 g',375,'https://www.drmax.cz/fenistil-drm-gel-50g-2','8596149002040'),
    ('HemaGel · 5 g',169,'HemaGel · 5 g','5 g',179,'https://www.drmax.cz/hemagel-5-g','8594177490013'),
    ('Octenisept kožní roztok · 100 ml',159,'Octenisept 1 mg/g + 20 mg/g kožní sprej, roztok · 50 ml','50 ml',188,'https://www.drmax.cz/octenisept-1-mg-g-20-mg-g-kozni-sprej-roztok-50-ml','4032651214877'),
    ('Octenisept 1 mg/g + 20 mg/g kožní sprej, roztok · 50 ml',159,'Octenisept 1 mg/g + 20 mg/g kožní sprej, roztok · 50 ml','50 ml',188,'https://www.drmax.cz/octenisept-1-mg-g-20-mg-g-kozni-sprej-roztok-50-ml','4032651214877'),
    ('Repelent PREDATOR FORTE · 150 ml',149,'Repelent PREDATOR FORTE · 150 ml','150 ml',null,'https://www.drmax.cz/repelent-predator-forte-spray-150ml','8595117101709')
  ), target as (
    select distinct on (o.id) o.id offer_id,o.product_id,m.*
    from public.offers o join map m on o.title=m.old_title and o.price=m.price
    where o.store_id=v_store_id and o.status='published'
    order by o.id
  )
  update public.products p
  set name=t.new_title,
      normalized_name=public.normalize_product_name(t.new_title),
      quantity_text=t.qty,
      ean=coalesce(nullif(p.ean,''),t.ean),
      metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object(
        'official_retailer','drmax.cz','official_retailer_url',t.url,'official_ean',t.ean,
        'official_identity_verified_at',now()
      ),
      updated_at=now()
  from target t where p.id=t.product_id;

  with map(old_title, price, new_title, qty, old_price, url, ean) as (values
    ('ALFASILVER sprej · 50 ml'::text,219::numeric,'ALFASILVER sprej · 50 ml','50 ml',null::numeric,'https://www.drmax.cz/alfasilver-sprej-50-ml','8017703744041'),
    ('Atix sprej pro bezpečné odstraňování klíšťat · 9 ml + pinzeta',269,'Atix sprej pro bezpečné odstraňování klíšťat · 9 ml + pinzeta','9 ml + pinzeta',null,'https://www.drmax.cz/atix-sada-pro-bezpecne-odstranovani-klistat-sprej-9-ml-pinzeta','5902596718282'),
    ('DERMATOP SILVERSPRAY · 50 ml',199,'DERMATOP SILVERSPRAY · 50 ml','50 ml',268,'https://www.drmax.cz/dermatop-silverspray-50-ml','8055267240241'),
    ('Fenistil 1 mg/g gel',299,'Fenistil 1 mg/g gel','50 g',375,'https://www.drmax.cz/fenistil-drm-gel-50g-2','8596149002040'),
    ('HemaGel · 5 g',169,'HemaGel · 5 g','5 g',179,'https://www.drmax.cz/hemagel-5-g','8594177490013'),
    ('Octenisept kožní roztok · 100 ml',159,'Octenisept 1 mg/g + 20 mg/g kožní sprej, roztok · 50 ml','50 ml',188,'https://www.drmax.cz/octenisept-1-mg-g-20-mg-g-kozni-sprej-roztok-50-ml','4032651214877'),
    ('Octenisept 1 mg/g + 20 mg/g kožní sprej, roztok · 50 ml',159,'Octenisept 1 mg/g + 20 mg/g kožní sprej, roztok · 50 ml','50 ml',188,'https://www.drmax.cz/octenisept-1-mg-g-20-mg-g-kozni-sprej-roztok-50-ml','4032651214877'),
    ('Repelent PREDATOR FORTE · 150 ml',149,'Repelent PREDATOR FORTE · 150 ml','150 ml',null,'https://www.drmax.cz/repelent-predator-forte-spray-150ml','8595117101709')
  )
  update public.offers o
  set title=m.new_title,
      normalized_title=public.normalize_product_name(m.new_title),
      old_price=coalesce(m.old_price,o.old_price),
      source_url=m.url,
      metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object(
        'leaflet_source_url',coalesce(o.metadata->>'leaflet_source_url',o.source_url),
        'official_product_url',m.url,'official_product_ean',m.ean,
        'official_product_identity_verified_at',now()
      ),
      updated_at=now()
  from map m
  where o.store_id=v_store_id and o.status='published' and o.title=m.old_title and o.price=m.price;

  update public.leaflet_import_items li
  set title='Octenisept 1 mg/g + 20 mg/g kožní sprej, roztok · 50 ml',quantity_text='50 ml',old_price=188,
      raw_data=coalesce(li.raw_data,'{}'::jsonb)||jsonb_build_object('manual_quality_correction','official_drmax_variant_50ml_at_159czk','previous_quantity_text','100 ml','corrected_at',now())
  from public.leaflet_imports imp
  where li.import_id=imp.id and imp.store_id=v_store_id and li.price=159
    and li.title in ('Octenisept kožní roztok · 100 ml','Octenisept 1 mg/g + 20 mg/g kožní sprej, roztok · 50 ml');
end $$;

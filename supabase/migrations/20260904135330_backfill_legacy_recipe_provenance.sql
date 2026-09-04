with recipe_map(custom_name, recipe_id) as (
  values
    ('Špagety (1 balení)','spagety'),
    ('Mleté hovězí maso (500 g)','spagety'),
    ('Rajčatové pyré (1 ks)','spagety'),
    ('Cibule (1 ks)','spagety'),
    ('Česnek (2 stroužky)','spagety'),
    ('Mrkev (1 ks)','spagety'),
    ('Parmazán (1 balení)','spagety'),
    ('Olivový olej (1 ks)','spagety'),
    ('Kuřecí prsa (600 g)','rizek'),
    ('Hladká mouka (1 balení)','rizek'),
    ('Vejce (3 ks)','rizek'),
    ('Strouhanka (1 balení)','rizek'),
    ('Olej na smažení (1 ks)','rizek'),
    ('Brambory (1 kg)','rizek'),
    ('Hovězí maso (800 g)','gulas'),
    ('Cibule (4 ks)','gulas'),
    ('Sádlo (1 ks)','gulas'),
    ('Sladká paprika (1 balení)','gulas'),
    ('Česnek (3 stroužky)','gulas'),
    ('Kmín (1 balení)','gulas'),
    ('Majoránka (1 balení)','gulas'),
    ('Hovězí vývar (1 l)','gulas'),
    ('Hladká mouka (250 g)','palacinky'),
    ('Mléko (500 ml)','palacinky'),
    ('Vejce (2 ks)','palacinky'),
    ('Olej (1 ks)','palacinky'),
    ('Marmeláda (1 ks)','palacinky')
), candidates as (
  select i.id, m.recipe_id
  from public.shopping_list_items i
  join recipe_map m on m.custom_name = i.custom_name
  where i.product_id is null
    and not i.is_recipe
    and i.quantity = 1
    and lower(coalesce(nullif(trim(i.unit),''),'ks')) = 'ks'
    and (
      (i.created_at >= timestamptz '2026-09-03 08:15:00+00' and i.created_at < timestamptz '2026-09-03 09:00:00+00')
      or
      (i.created_at >= timestamptz '2026-09-03 20:46:00+00' and i.created_at < timestamptz '2026-09-03 20:48:00+00')
    )
)
update public.shopping_list_items i
   set is_recipe = true,
       recipe_ids = array[c.recipe_id]::text[],
       updated_at = i.updated_at
  from candidates c
 where i.id = c.id;

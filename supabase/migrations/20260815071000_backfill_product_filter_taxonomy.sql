update public.products p
set
  filter_group = case c.slug
    when 'napoje' then 'drinks'
    when 'domacnost' then 'home'
    when 'drogerie' then 'drugstore'
    when 'pecivo' then 'food'
    when 'elektronika' then 'electronics'
    when 'auto' then 'other'
    when 'cestovani-pobyty' then 'other'
    when 'maso-ryby' then 'food'
    when 'mlecne-vyrobky' then 'food'
    when 'moda' then 'fashion'
    when 'ovoce-zelenina' then 'food'
    when 'sladkosti' then 'food'
    when 'trvanlive-potraviny' then 'food'
    else 'other'
  end,
  filter_tags = case c.slug
    when 'napoje' then array['napoje']
    when 'drogerie' then array['drogerie']
    when 'pecivo' then array['pecivo']
    when 'maso-ryby' then array['maso','ryby']
    when 'mlecne-vyrobky' then array['mleko','maslo','syr']
    when 'ovoce-zelenina' then array['ovoce','zelenina']
    when 'sladkosti' then array['sladkosti']
    else array[c.slug]
  end,
  classification_confidence = 1,
  classification_source = 'existing_category',
  classified_at = now()
from public.categories c
where p.category_id = c.id
  and p.filter_group is null;

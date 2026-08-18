with live as (
  select distinct p.id,p.name,lower(unaccent(coalesce(p.name,''))) n
  from products p
  join offers o on o.product_id=p.id
  where p.category_id is null
    and p.is_active is true
    and o.status='published'
    and o.is_verified is true
    and (o.valid_to is null or o.valid_to>=current_date)
), home as (
  select * from live where public.infer_public_filter_group(name,null)='home'
), candidates as (
  select id
  from home
  where n ~ '\m(hrnec|panev|rucnik|povleceni|stul|zidle|drez|svitidlo|zarovka)\M'
    and n !~ '\m(dlazba|naradi|aku|bruska|vrtaci|profesional|professional|zahradni)\M'
), cat as (
  select id from categories where slug='domacnost'
)
update products p
set category_id=cat.id,
    filter_group='home',
    filter_tags=array['domacnost']::text[],
    classification_confidence=0.99,
    classification_source='home-subcategory-exact-v1',
    updated_at=now()
from candidates c, cat
where p.id=c.id and p.category_id is null;

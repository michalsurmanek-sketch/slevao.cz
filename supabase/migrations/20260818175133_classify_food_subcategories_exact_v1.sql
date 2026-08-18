with live as (
  select distinct p.id,p.name,lower(unaccent(coalesce(p.name,''))) n
  from products p
  join offers o on o.product_id=p.id
  where p.category_id is null
    and p.is_active is true
    and o.status='published'
    and o.is_verified is true
    and (o.valid_to is null or o.valid_to>=current_date)
), food as (
  select * from live where public.infer_public_filter_group(name,null)='food'
), classified as (
  select id,
    case
      when n ~ '\m(veprovy|veprova|veprove|hovezi|kureci|kruti|kachni|jehneci|kralici|krkovice|kyta|plec|kotleta|panenka|svickova|steak|bucek|sunka|salam|klobasa|parek|slanina|ryba|losos|treska|tunak|kapr|pstruh|makrela|prazma|candat)\M'
        and n !~ '\m(krmivo|kocky|psy|bujon|hotove jidlo|hotovy pokrm|s ryzi|konzerva pro)\M' then 'maso-ryby'
      when n ~ '\m(jogurt|tvaroh|syr|eidam|gouda|hermelin|mozzarella|smetana|kefir|lipanek|pomazankove)\M'
        and n !~ '\m(zmrzlin|odlicovaci|telove|pletove|kosmeticke|cistici)\M' then 'mlecne-vyrobky'
      when n ~ '\m(mleko)\M'
        and n !~ '\m(zmrzlin|odlicovaci|telove|pletove|kosmeticke|cistici|opalov|po opalov|na telo)\M'
        and n !~ 'mleko na$' then 'mlecne-vyrobky'
      when n ~ '\mmaslo\M'
        and n !~ '\m(arasid|zmrzlin|telove|kosmeticke)\M' then 'mlecne-vyrobky'
      when n ~ '\m(chleb|rohlik|houska|bageta|croissant|kobliha|kolac|pecivo)\M' then 'pecivo'
      when n ~ '\m(cokolada|bonbon|susenk|oplatka|tycinka|bonboniera)\M'
        and n !~ '\m(konturovaci|contour|stick|makeup|dermacol|wet n wild|kosmetick)\M' then 'sladkosti'
      when n ~ '\m(mouka|ryze|testoviny|fazole|cocka|olej|konzerva|kecup|horcice|cukr|sul)\M'
        and n !~ '\m(mlecna ryze|pro kocky|pro psy)\M' then 'trvanlive-potraviny'
      else null
    end slug
  from food
), mapped as (
  select c.id product_id, cat.id category_id, c.slug
  from classified c
  join categories cat on cat.slug=c.slug
  where c.slug is not null
)
update products p
set category_id=m.category_id,
    filter_group='food',
    filter_tags=array[m.slug]::text[],
    classification_confidence=0.98,
    classification_source='food-subcategory-exact-v1',
    updated_at=now()
from mapped m
where p.id=m.product_id and p.category_id is null;

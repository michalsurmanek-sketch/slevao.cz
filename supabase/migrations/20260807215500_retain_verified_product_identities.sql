-- Slevao.cz: přeznačení pouze již existujících, ověřených a bezpečně
-- identifikovaných vazeb nabídka -> produkt. Product_id, ceny ani obrázky se nemění.

update public.offers o
set catalog_match_status = 'retained',
    catalog_match_score = 1,
    catalog_checked_at = now()
from public.products p
where p.id = o.product_id
  and o.status = 'published'
  and o.valid_from <= current_date
  and o.valid_to >= current_date
  and o.is_verified = true
  and o.catalog_match_status = 'needs_review'
  and public.product_identity_match_safe(
    o.title,
    p.name,
    p.brand,
    p.quantity_text
  );

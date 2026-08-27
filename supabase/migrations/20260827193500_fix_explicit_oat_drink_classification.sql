-- One strong product identity arrived with an explicit pharmacy group from its source store.
-- Keep the central v10 classifier conservative about explicit overrides, and correct
-- this exact product identity as an audited exception.

update public.products
set filter_group = 'drinks'
where public.normalize_text(name) = 'ovesny napoj 1 l'
  and coalesce(filter_group,'other') = 'pharmacy';

update public.stores
set logo_url='https://www.google.com/s2/favicons?sz=256&domain_url=https://globus.cz',
    updated_at=now()
where slug='globus'
  and logo_url like '%google.com/search%';

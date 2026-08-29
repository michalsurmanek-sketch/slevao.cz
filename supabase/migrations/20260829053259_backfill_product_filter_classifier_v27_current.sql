update public.products p
set metadata = coalesce(p.metadata,'{}'::jsonb)
where coalesce(nullif(trim(p.filter_group),''),'other')='other'
  and lower(coalesce(p.metadata->>'source_store_slug','')) in ('globus','kaufland','kosik','pilulka')
  and public.infer_product_filter_group_source_rules(p.name,p.quantity_text,p.metadata) <> 'other'
  and p.id in (
    select distinct o.product_id
    from public.offers o
    where o.status='published'
      and coalesce(o.valid_from,current_date)<=current_date
      and coalesce(o.valid_to,current_date)>=current_date
  );

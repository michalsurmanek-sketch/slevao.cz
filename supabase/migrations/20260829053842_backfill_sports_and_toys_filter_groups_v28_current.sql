update public.products p
set metadata = coalesce(p.metadata,'{}'::jsonb)
where coalesce(nullif(trim(p.filter_group),''),'other')='other'
  and public.infer_product_filter_group_activity_v28(p.name,p.quantity_text,p.metadata) <> 'other'
  and p.id in (
    select distinct o.product_id
    from public.offers o
    where o.status='published'
      and coalesce(o.valid_from,current_date)<=current_date
      and coalesce(o.valid_to,current_date)>=current_date
  );

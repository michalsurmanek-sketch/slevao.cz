create unique index if not exists shopping_list_items_one_custom_name_per_list_uidx
on public.shopping_list_items(shopping_list_id, lower(trim(custom_name)))
where product_id is null and nullif(trim(custom_name), '') is not null;

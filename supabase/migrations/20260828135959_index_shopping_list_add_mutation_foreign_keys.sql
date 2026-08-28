create index if not exists shopping_list_add_mutations_list_idx
  on public.shopping_list_add_mutations (shopping_list_id);

create index if not exists shopping_list_add_mutations_item_idx
  on public.shopping_list_add_mutations (item_id)
  where item_id is not null;

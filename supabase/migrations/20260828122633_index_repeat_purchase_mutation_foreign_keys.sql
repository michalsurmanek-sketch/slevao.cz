create index if not exists shopping_purchase_repeat_mutations_purchase_idx
  on public.shopping_purchase_repeat_mutations(purchase_id);

create index if not exists shopping_purchase_repeat_mutations_list_idx
  on public.shopping_purchase_repeat_mutations(shopping_list_id);

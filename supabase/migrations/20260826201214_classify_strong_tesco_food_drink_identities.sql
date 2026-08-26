update public.products
set filter_group = case
  when public.normalize_text(name) in (
    'staropramen 11 0 5 l',
    'staropramen 12',
    'staropramen 12 0 5 l',
    'vsechny ugo dzusy 250 ml'
  ) then 'drinks'
  when public.normalize_text(name) in (
    'emco mysli',
    'kaiserka cerealni',
    'medovnik',
    'tesco finest dalamanek se soli a kminem',
    'trojuhelnik s kurecim masem'
  ) then 'food'
  else filter_group
end,
updated_at = now()
where filter_group is null
  and public.normalize_text(name) in (
    'staropramen 11 0 5 l',
    'staropramen 12',
    'staropramen 12 0 5 l',
    'vsechny ugo dzusy 250 ml',
    'emco mysli',
    'kaiserka cerealni',
    'medovnik',
    'tesco finest dalamanek se soli a kminem',
    'trojuhelnik s kurecim masem'
  );

update public.products
set filter_group = case
  when public.normalize_text(name) ~ '^(allini piu secco|argus 10 original|argus 12 dark|camaro cerveza extra|chroast kafe|cimarosa merlot|deluxe sauvignon blanc|gruner veltliner|kinley tonic|legendario elixir de cuba|magnesia plus|svijany svijansky maz)' then 'drinks'
  when public.normalize_text(name) ~ '^(bbq chlebik|chef select hummus natur|chobotnice chapadla|confiserie firenze babovka|el tequito chilli con carne|emco super srdicka bez cukru|ferrero rocher|hame pomazanky|hello ovocna kapsicka|indiana jerky|kania instantni nudlova polevka|knorr jiska|latin american style mini salamky|maribel med kvetovy|medovnik original piknik pikao|tastino sumavsky krajic)' then 'food'
  else filter_group
end,
updated_at=now()
where filter_group is null
  and public.normalize_text(name) ~ '^(allini piu secco|argus 10 original|argus 12 dark|camaro cerveza extra|chroast kafe|cimarosa merlot|deluxe sauvignon blanc|gruner veltliner|kinley tonic|legendario elixir de cuba|magnesia plus|svijany svijansky maz|bbq chlebik|chef select hummus natur|chobotnice chapadla|confiserie firenze babovka|el tequito chilli con carne|emco super srdicka bez cukru|ferrero rocher|hame pomazanky|hello ovocna kapsicka|indiana jerky|kania instantni nudlova polevka|knorr jiska|latin american style mini salamky|maribel med kvetovy|medovnik original piknik pikao|tastino sumavsky krajic)';

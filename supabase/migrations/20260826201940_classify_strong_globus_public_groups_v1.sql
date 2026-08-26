update public.products
set filter_group = case
  when public.normalize_text(name) ~ '^(adventuros training zverina|darling masova smes)' then 'pets'
  when public.normalize_text(name) ~ '^(algida kids mix|bahlsen hit chocolate|emco pan hrasek|hamanek teleci se zeleninou|hami masozeleninovy prikrm|hipp bio bolonske spagety prikrm|lays salted|lindt lindor smes|lorenz monster munch|nestle kaktus water ice)' then 'food'
  when public.normalize_text(name) ~ '^(habanske sklepy tramin cerveny polosuche|professorado original 35|sierra tequila blanco)' then 'drinks'
  when public.normalize_text(name) ~ '^(curaprox cps 07 prime|domestos pine tekuty dezinfekcni|gliss regeneracni maska|jar prostredek na myti nadobi|lenor vonne perlicky|natuvell dentalni nit)' then 'drugstore'
  when public.normalize_text(name) ~ '^k2 osvezovac klima fresh' then 'auto'
  else filter_group
end,
updated_at = now()
where filter_group is null
  and (
    public.normalize_text(name) ~ '^(adventuros training zverina|darling masova smes|algida kids mix|bahlsen hit chocolate|emco pan hrasek|hamanek teleci se zeleninou|hami masozeleninovy prikrm|hipp bio bolonske spagety prikrm|lays salted|lindt lindor smes|lorenz monster munch|nestle kaktus water ice|habanske sklepy tramin cerveny polosuche|professorado original 35|sierra tequila blanco|curaprox cps 07 prime|domestos pine tekuty dezinfekcni|gliss regeneracni maska|jar prostredek na myti nadobi|lenor vonne perlicky|natuvell dentalni nit|k2 osvezovac klima fresh)'
  );

create or replace function public.sanitize_tesco_structured_product_title()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $$
begin
  if coalesce(new.metadata->>'adapter','') = 'tesco-apollo-pdf-v16-semantic-public'
     and public.normalize_text(coalesce(new.name,'')) = 'ts vejce podest s30 ks' then
    new.name := 'Tesco čerstvá vejce z podestýlky S';
    new.normalized_name := public.normalize_text(new.name);
  end if;
  return new;
end;
$$;

drop trigger if exists sanitize_tesco_structured_product_title_trg on public.products;
create trigger sanitize_tesco_structured_product_title_trg
before insert or update of name, normalized_name, metadata on public.products
for each row execute function public.sanitize_tesco_structured_product_title();

create or replace function public.sanitize_tesco_structured_offer_title()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $$
begin
  if coalesce(new.metadata->>'adapter','') = 'tesco-apollo-pdf-v16-semantic-public'
     and public.normalize_text(coalesce(new.title,'')) = 'ts vejce podest s30 ks' then
    new.title := 'Tesco čerstvá vejce z podestýlky S';
    new.normalized_title := public.normalize_text(new.title);
  end if;
  return new;
end;
$$;

drop trigger if exists sanitize_tesco_structured_offer_title_trg on public.offers;
create trigger sanitize_tesco_structured_offer_title_trg
before insert or update of title, normalized_title, metadata on public.offers
for each row execute function public.sanitize_tesco_structured_offer_title();

update public.products
set name = name,
    updated_at = now()
where metadata->>'adapter' = 'tesco-apollo-pdf-v16-semantic-public'
  and public.normalize_text(name) = 'ts vejce podest s30 ks';

update public.offers
set title = title,
    updated_at = now()
where metadata->>'adapter' = 'tesco-apollo-pdf-v16-semantic-public'
  and public.normalize_text(title) = 'ts vejce podest s30 ks';

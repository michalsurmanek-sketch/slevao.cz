-- Slevao.cz: atomické vytvoření produktu a nabídky z administrace

create or replace function public.admin_create_offer(
  product_name text,
  target_store_id uuid,
  target_category_id uuid,
  target_price numeric,
  target_old_price numeric,
  target_image_url text,
  target_valid_from date,
  target_valid_to date,
  target_status text
)
returns public.offers
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  matched_product_id uuid;
  matching_products integer;
  created_offer public.offers;
begin
  if current_role not in ('admin', 'editor') then
    raise exception 'Nedostatečné oprávnění.' using errcode = '42501';
  end if;

  product_name := trim(coalesce(product_name, ''));
  target_status := coalesce(nullif(target_status, ''), 'review');

  if product_name = '' then
    raise exception 'Název produktu je povinný.';
  end if;
  if target_store_id is null then
    raise exception 'Obchod je povinný.';
  end if;
  if target_price is null or target_price <= 0 then
    raise exception 'Akční cena musí být vyšší než nula.';
  end if;
  if target_old_price is not null and target_old_price < target_price then
    raise exception 'Původní cena nesmí být nižší než akční cena.';
  end if;
  if target_valid_from is null or target_valid_to is null or target_valid_from > target_valid_to then
    raise exception 'Neplatné datum platnosti.';
  end if;
  if target_status not in ('published', 'draft', 'review', 'expired') then
    raise exception 'Neplatný stav nabídky.';
  end if;
  if target_status = 'published' and target_valid_to < current_date then
    raise exception 'Prošlou nabídku nelze publikovat.';
  end if;

  select count(*)
  into matching_products
  from public.products
  where lower(trim(name)) = lower(product_name);

  if matching_products > 1 then
    raise exception 'V databázi je více produktů se stejným názvem. Vyber existující produkt v našeptávači.';
  end if;

  if matching_products = 1 then
    select id
    into matched_product_id
    from public.products
    where lower(trim(name)) = lower(product_name)
    limit 1;
  end if;

  if matched_product_id is null then
    insert into public.products(name, category_id, image_url, is_verified)
    values (product_name, target_category_id, nullif(trim(coalesce(target_image_url, '')), ''), true)
    returning id into matched_product_id;
  else
    update public.products
    set category_id = coalesce(category_id, target_category_id),
        image_url = case
          when (image_url is null or image_url = '') and nullif(trim(coalesce(target_image_url, '')), '') is not null
            then nullif(trim(target_image_url), '')
          else image_url
        end
    where id = matched_product_id;
  end if;

  insert into public.offers(
    product_id, store_id, title, price, old_price, image_url,
    valid_from, valid_to, status, is_verified, published_at
  ) values (
    matched_product_id,
    target_store_id,
    product_name,
    target_price,
    target_old_price,
    nullif(trim(coalesce(target_image_url, '')), ''),
    target_valid_from,
    target_valid_to,
    target_status,
    true,
    case when target_status = 'published' then now() else null end
  )
  returning * into created_offer;

  insert into public.admin_audit_log(
    actor_id, actor_email, action, entity_type, entity_id, after_data
  ) values (
    auth.uid(), auth.jwt() ->> 'email', 'offer_create', 'offer', created_offer.id,
    to_jsonb(created_offer)
  );

  return created_offer;
end;
$$;

grant execute on function public.admin_create_offer(text, uuid, uuid, numeric, numeric, text, date, date, text)
to authenticated;

-- Slevao.cz: transakční uložení nabídky s možností výslovně vybrat existující produkt.

create or replace function public.admin_create_offer_v2(
  product_name text,
  target_store_id uuid,
  target_category_id uuid,
  target_price numeric,
  target_old_price numeric,
  target_image_url text,
  target_valid_from date,
  target_valid_to date,
  target_status text,
  target_product_id uuid default null
)
returns public.offers
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  matched_product public.products;
  matching_products integer;
  created_offer public.offers;
begin
  if current_role not in ('admin', 'editor') then
    raise exception 'Nedostatečné oprávnění.' using errcode = '42501';
  end if;

  product_name := trim(coalesce(product_name, ''));
  target_status := coalesce(nullif(target_status, ''), 'review');

  if product_name = '' then raise exception 'Název produktu je povinný.'; end if;
  if target_store_id is null then raise exception 'Obchod je povinný.'; end if;
  if target_price is null or target_price <= 0 then raise exception 'Akční cena musí být vyšší než nula.'; end if;
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

  perform 1 from public.stores where id = target_store_id and is_active = true;
  if not found then raise exception 'Vybraný obchod neexistuje nebo je skrytý.'; end if;

  if target_product_id is not null then
    select * into matched_product
    from public.products
    where id = target_product_id
    for update;
    if matched_product.id is null then raise exception 'Vybraný produkt už neexistuje.'; end if;
  else
    select count(*) into matching_products
    from public.products
    where public.normalize_product_name(name) = public.normalize_product_name(product_name);

    if matching_products > 1 then
      raise exception 'V databázi je více produktů se stejným názvem. Vyber konkrétní produkt z našeptávače.';
    end if;

    if matching_products = 1 then
      select * into matched_product
      from public.products
      where public.normalize_product_name(name) = public.normalize_product_name(product_name)
      limit 1
      for update;
    end if;
  end if;

  if matched_product.id is null then
    insert into public.products(name, category_id, image_url, is_verified)
    values (product_name, target_category_id, nullif(trim(coalesce(target_image_url, '')), ''), true)
    returning * into matched_product;
  else
    update public.products
    set category_id = coalesce(category_id, target_category_id),
        image_url = case
          when coalesce(image_url, '') = '' and nullif(trim(coalesce(target_image_url, '')), '') is not null
            then nullif(trim(target_image_url), '')
          else image_url
        end
    where id = matched_product.id
    returning * into matched_product;
  end if;

  insert into public.offers(
    product_id, store_id, category_id, title, price, old_price, image_url,
    valid_from, valid_to, status, is_verified, published_at
  ) values (
    matched_product.id,
    target_store_id,
    target_category_id,
    product_name,
    target_price,
    target_old_price,
    coalesce(nullif(trim(coalesce(target_image_url, '')), ''), matched_product.image_url),
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

grant execute on function public.admin_create_offer_v2(text, uuid, uuid, numeric, numeric, text, date, date, text, uuid)
to authenticated;

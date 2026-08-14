-- A product image is presentation data, not an identity signal. When several
-- products share an alias/name, do not select the only candidate with an image.

create or replace function public.resolve_product_for_import(
  p_title text,
  p_brand text default null,
  p_quantity text default null,
  p_ean text default null,
  p_store_id uuid default null
)
returns table(matched_product_id uuid, matched_image_url text, match_type text, match_score numeric)
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  normalized_title text := public.normalize_product_name(p_title);
  clean_ean text := nullif(regexp_replace(coalesce(p_ean, ''), '\D', '', 'g'), '');
  candidate_count integer := 0;
begin
  if clean_ean is not null and length(clean_ean) between 8 and 14 then
    select count(distinct p.id) into candidate_count
    from public.products p
    where p.is_active = true
      and regexp_replace(coalesce(p.ean, ''), '\D', '', 'g') = clean_ean;

    if candidate_count = 1 then
      return query
      select p.id, public.active_verified_product_image(p.id), 'ean_exact'::text, 1.0000::numeric
      from public.products p
      where p.is_active = true
        and regexp_replace(coalesce(p.ean, ''), '\D', '', 'g') = clean_ean
      limit 1;
      return;
    end if;
  end if;

  if normalized_title = '' then return; end if;

  if p_store_id is not null then
    select count(distinct p.id) into candidate_count
    from public.product_aliases a
    join public.products p on p.id = a.product_id
    where p.is_active = true
      and a.normalized_alias = normalized_title
      and a.source_store_id = p_store_id
      and public.product_match_brand_compatible(coalesce(a.brand, p.brand), p_brand)
      and public.product_match_quantity_compatible(coalesce(a.quantity_text, p.quantity_text), p_quantity);

    if candidate_count = 1 then
      return query
      select p.id, public.active_verified_product_image(p.id), 'store_alias_exact'::text, 0.9950::numeric
      from public.product_aliases a
      join public.products p on p.id = a.product_id
      where p.is_active = true
        and a.normalized_alias = normalized_title
        and a.source_store_id = p_store_id
        and public.product_match_brand_compatible(coalesce(a.brand, p.brand), p_brand)
        and public.product_match_quantity_compatible(coalesce(a.quantity_text, p.quantity_text), p_quantity)
      order by a.confidence desc, p.id
      limit 1;
      return;
    end if;
  end if;

  select count(distinct p.id) into candidate_count
  from public.product_aliases a
  join public.products p on p.id = a.product_id
  where p.is_active = true
    and a.normalized_alias = normalized_title
    and public.product_match_brand_compatible(coalesce(a.brand, p.brand), p_brand)
    and public.product_match_quantity_compatible(coalesce(a.quantity_text, p.quantity_text), p_quantity);

  if candidate_count = 1 then
    return query
    select p.id, public.active_verified_product_image(p.id), 'alias_exact'::text, 0.9850::numeric
    from public.product_aliases a
    join public.products p on p.id = a.product_id
    where p.is_active = true
      and a.normalized_alias = normalized_title
      and public.product_match_brand_compatible(coalesce(a.brand, p.brand), p_brand)
      and public.product_match_quantity_compatible(coalesce(a.quantity_text, p.quantity_text), p_quantity)
    order by a.confidence desc, p.id
    limit 1;
    return;
  end if;

  select count(distinct p.id) into candidate_count
  from public.products p
  where p.is_active = true
    and p.normalized_name = normalized_title
    and public.product_match_brand_compatible(p.brand, p_brand)
    and public.product_match_quantity_compatible(p.quantity_text, p_quantity);

  if candidate_count = 1 then
    return query
    select p.id, public.active_verified_product_image(p.id), 'name_exact'::text, 0.9750::numeric
    from public.products p
    where p.is_active = true
      and p.normalized_name = normalized_title
      and public.product_match_brand_compatible(p.brand, p_brand)
      and public.product_match_quantity_compatible(p.quantity_text, p_quantity)
    limit 1;
  end if;
end;
$function$;

revoke all on function public.resolve_product_for_import(text,text,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_product_for_import(text,text,text,text,uuid)
  to service_role;


-- Slevao.cz: bezpečná přesná shoda názvu master produktu má přednost před aliasem.
-- Alias se použije pouze pokud žádný bezpečný exact master kandidát neexistuje.
-- Tím starý alias nemůže blokovat jednoznačné sjednocení nového master produktu.

create or replace function public.match_offer_to_product_master()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_title text;
  matched_product_id uuid;
  matched_image_url text;
  candidate_count integer := 0;
  previous_product_id uuid;
begin
  normalized_title := public.normalize_product_name(new.title);
  previous_product_id := case when tg_op = 'UPDATE' then old.product_id else new.product_id end;

  if normalized_title = '' or not public.product_label_is_specific(new.title) then
    if tg_op = 'UPDATE' and new.product_id is distinct from old.product_id then
      new.product_id := old.product_id;
      new.image_url := old.image_url;
      new.catalog_match_status := 'needs_review';
      new.catalog_match_score := null;
      new.catalog_checked_at := now();
    elsif new.image_url like '%/leaflet-crops/%' then
      new.image_url := null;
    end if;
    return new;
  end if;

  -- 1) Nejdřív pouze přesné bezpečné shody s hlavním názvem produktu.
  with candidates as (
    select distinct
      p.id,
      case
        when p.image_url is not null
          and p.image_verified = true
          and coalesce(p.image_quality, 0) >= 70
          and p.image_url not like '%/leaflet-crops/%'
        then p.image_url
        else null
      end as approved_image
    from public.products p
    where p.normalized_name = normalized_title
      and public.product_identity_match_safe(new.title, p.name, p.brand, p.quantity_text)
  ), ranked as (
    select *, count(*) over () as total
    from candidates
    order by (approved_image is not null) desc, id
  )
  select id, approved_image, total
    into matched_product_id, matched_image_url, candidate_count
  from ranked
  limit 1;

  if not found then
    candidate_count := 0;
    matched_product_id := null;
    matched_image_url := null;
  end if;

  -- 2) Alias je fallback jen pokud neexistuje žádný bezpečný exact master kandidát.
  if candidate_count = 0 then
    with candidates as (
      select distinct
        p.id,
        case
          when p.image_url is not null
            and p.image_verified = true
            and coalesce(p.image_quality, 0) >= 70
            and p.image_url not like '%/leaflet-crops/%'
          then p.image_url
          else null
        end as approved_image
      from public.product_aliases a
      join public.products p on p.id = a.product_id
      where a.normalized_alias = normalized_title
        and a.confidence >= 0.92
        and (a.brand is not null or a.quantity_text is not null)
        and public.product_identity_match_safe(
          new.title,
          a.alias,
          coalesce(a.brand, p.brand),
          coalesce(a.quantity_text, p.quantity_text)
        )
    ), ranked as (
      select *, count(*) over () as total
      from candidates
      order by (approved_image is not null) desc, id
    )
    select id, approved_image, total
      into matched_product_id, matched_image_url, candidate_count
    from ranked
    limit 1;

    if not found then
      candidate_count := 0;
      matched_product_id := null;
      matched_image_url := null;
    end if;
  end if;

  if candidate_count = 1 then
    new.product_id := matched_product_id;
    if matched_image_url is not null then
      new.image_url := matched_image_url;
    elsif new.image_url like '%/leaflet-crops/%' then
      new.image_url := null;
    end if;
    new.catalog_match_status := case
      when previous_product_id = matched_product_id then 'retained'
      else 'matched'
    end;
    new.catalog_match_score := 1;
    new.catalog_checked_at := now();
  else
    -- Žádná nebo více bezpečných kandidátů: product_id neměnit.
    if tg_op = 'UPDATE' and new.product_id is distinct from old.product_id then
      new.product_id := old.product_id;
      new.image_url := old.image_url;
      new.catalog_match_status := 'needs_review';
      new.catalog_match_score := null;
      new.catalog_checked_at := now();
    elsif new.image_url like '%/leaflet-crops/%' then
      new.image_url := null;
    end if;
  end if;

  return new;
end;
$$;

-- Zopakovat pouze bezpečný exact relink, který předchozí verze odmítla kvůli
-- kolizi se starým aliasem. UUID nejsou natvrdo; kandidát se znovu odvodí z dat.
create temp table _slevao_exact_verified_relinks_v2 on commit drop as
with offer_base as (
  select
    o.id,
    o.title,
    o.product_id,
    public.normalize_product_name(o.title) as normalized_title
  from public.offers o
  where o.status = 'published'
    and o.valid_from <= current_date
    and o.valid_to >= current_date
    and o.catalog_match_status = 'needs_review'
    and o.is_verified = true
    and o.product_id is not null
), candidate_rows as (
  select
    ob.id as offer_id,
    ob.product_id as current_product_id,
    p.id as candidate_product_id
  from offer_base ob
  join public.products p on p.normalized_name = ob.normalized_title
  where p.id is distinct from ob.product_id
    and public.product_identity_match_safe(ob.title, p.name, p.brand, p.quantity_text)
), unique_candidates as (
  select
    offer_id,
    min(current_product_id::text)::uuid as current_product_id,
    min(candidate_product_id::text)::uuid as candidate_product_id,
    count(distinct candidate_product_id) as candidate_count
  from candidate_rows
  group by offer_id
)
select offer_id,current_product_id,candidate_product_id
from unique_candidates
where candidate_count = 1;

update public.leaflet_import_items li
set product_id = r.candidate_product_id
from _slevao_exact_verified_relinks_v2 r
join public.offers o on o.id = r.offer_id
where li.product_id = r.current_product_id
  and li.title = o.title;

update public.offers o
set product_id = r.candidate_product_id
from _slevao_exact_verified_relinks_v2 r
where o.id = r.offer_id;

-- Oprava chybných cen z automatických parserů.
-- Action HTML rozděluje 32,90 na dvě textové části "32 90".
-- Základní PDF parser naopak u řádku "1 kg = 83,17 Kč" historicky vzal první číslo 1.

create or replace function public.guard_import_item_price_quality()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parser text := lower(coalesce(new.raw_data->>'parser', ''));
  v_raw_text text := coalesce(new.raw_data->>'raw_text', '');
  v_price_line text := coalesce(new.raw_data->>'price_line', '');
  v_match text[];
  v_corrected numeric;
begin
  -- Action: "... 32 90 Týdenní akce" znamená 32,90 Kč, ne 0,90 Kč.
  if v_parser = 'action-html-v1' then
    v_match := regexp_match(v_raw_text, '(?:^|\s)([0-9]{1,5})\s+([0-9]{2})\s*Týdenní akce\s*$', 'i');
    if v_match is not null then
      v_corrected := (v_match[1] || '.' || v_match[2])::numeric;
      if v_corrected >= 2 and v_corrected < 100000 then
        new.price := v_corrected;
        new.raw_data := jsonb_set(
          jsonb_set(coalesce(new.raw_data, '{}'::jsonb), '{parser}', to_jsonb('action-html-v1-db-fixed'::text), true),
          '{price_quality_fix}',
          jsonb_build_object('reason', 'split_integer_decimal_html', 'corrected_price', v_corrected),
          true
        );
      end if;
    end if;
  end if;

  -- PDF text parser: "1 kg = 83,17 Kč" je jednotková cena. Číslo 1 není prodejní cena.
  if v_parser = 'pdf-text-v1'
     and coalesce(new.price, 0) < 2
     and v_price_line ~* '^\s*(?:1\s*(?:kg|l|ks|m|m2|m²)\s*=|100\s*(?:g|ml)\s*=)'
  then
    new.status := 'failed';
    new.raw_data := jsonb_set(
      coalesce(new.raw_data, '{}'::jsonb),
      '{price_quality_rejection}',
      jsonb_build_object('reason', 'unit_price_misread_as_sale_price', 'original_price', new.price),
      true
    );
  end if;

  -- Poslední pojistka pro automatické parsery: pod 2 Kč se položka nesmí dostat do review/approved/published.
  if v_parser <> ''
     and coalesce(new.price, 0) < 2
     and new.status in ('review', 'approved', 'published')
  then
    new.status := 'failed';
    new.raw_data := jsonb_set(
      coalesce(new.raw_data, '{}'::jsonb),
      '{price_quality_rejection}',
      jsonb_build_object('reason', 'implausible_automatic_price_under_2_czk', 'original_price', new.price),
      true
    );
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_import_item_price_quality() from public, anon, authenticated;

drop trigger if exists trg_guard_import_item_price_quality on public.leaflet_import_items;
create trigger trg_guard_import_item_price_quality
before insert or update of price, raw_data, status
on public.leaflet_import_items
for each row execute function public.guard_import_item_price_quality();

-- Oprav už existující Action import items podle původního raw_text.
with parsed as (
  select lii.id,
         ((m)[1] || '.' || (m)[2])::numeric as corrected_price
  from public.leaflet_import_items lii
  join public.leaflet_imports li on li.id = lii.import_id
  join public.stores s on s.id = li.store_id
  cross join lateral regexp_match(
    coalesce(lii.raw_data->>'raw_text', ''),
    '(?:^|\s)([0-9]{1,5})\s+([0-9]{2})\s*Týdenní akce\s*$',
    'i'
  ) m
  where s.slug = 'action'
    and lower(coalesce(lii.raw_data->>'parser', '')) = 'action-html-v1'
    and lii.price < 2
)
update public.leaflet_import_items lii
set price = p.corrected_price,
    raw_data = jsonb_set(
      jsonb_set(coalesce(lii.raw_data, '{}'::jsonb), '{parser}', to_jsonb('action-html-v1-db-fixed'::text), true),
      '{price_quality_fix}',
      jsonb_build_object('reason', 'split_integer_decimal_html', 'corrected_price', p.corrected_price),
      true
    )
from parsed p
where lii.id = p.id
  and p.corrected_price >= 2
  and p.corrected_price < 100000;

-- Přepiš současné chybné Action offers podle opravených import items.
with corrected as (
  select distinct on (lii.product_id)
         lii.product_id,
         lii.price
  from public.leaflet_import_items lii
  join public.leaflet_imports li on li.id = lii.import_id
  join public.stores s on s.id = li.store_id
  where s.slug = 'action'
    and lii.product_id is not null
    and lii.price >= 2
    and lii.raw_data->>'parser' = 'action-html-v1-db-fixed'
  order by lii.product_id, lii.created_at desc
), action_store as (
  select id from public.stores where slug = 'action' limit 1
)
update public.offers o
set price = c.price,
    metadata = coalesce(o.metadata, '{}'::jsonb) || jsonb_build_object(
      'price_quality_fix', 'action_split_integer_decimal_html',
      'price_quality_fixed_at', now()
    ),
    updated_at = now()
from corrected c, action_store s
where o.store_id = s.id
  and o.product_id = c.product_id
  and o.status = 'published'
  and o.price < 2;

-- Všechny ostatní publikované ceny pod 2 Kč stáhni z veřejného feedu.
update public.offers
set status = 'rejected',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'quality_rejection', 'implausible_price_under_2_czk',
      'quality_rejected_at', now()
    ),
    updated_at = now()
where status = 'published'
  and price < 2;

-- Příslušné automaticky vytěžené položky už nesmí být znovu publikovatelné.
update public.leaflet_import_items
set status = 'failed',
    raw_data = jsonb_set(
      coalesce(raw_data, '{}'::jsonb),
      '{price_quality_rejection}',
      jsonb_build_object('reason', 'implausible_automatic_price_under_2_czk', 'original_price', price),
      true
    )
where price < 2
  and coalesce(raw_data->>'parser', '') <> ''
  and status in ('review', 'approved', 'published');

-- Databázová poslední bariéra: publikovaná nabídka nesmí mít cenu pod 2 Kč.
alter table public.offers drop constraint if exists offers_published_min_price_check;
alter table public.offers
  add constraint offers_published_min_price_check
  check (status <> 'published' or price >= 2);

-- Ve veřejném katalogovém hledání skrývej neověřené auto-importované produkty,
-- pokud za nimi už není žádná platná a cenově smysluplná publikovaná nabídka.
create or replace function public.search_products_catalog(search_query text, result_limit integer default 120)
returns table(id uuid, name text, brand text, quantity_text text, image_url text, slug text, category_id uuid, relevance double precision)
language sql
stable
security definer
set search_path = public
as $$
  with input as (
    select trim(regexp_replace(unaccent(lower(coalesce(search_query, ''))), '[^a-z0-9]+', ' ', 'g')) as needle
  ), ranked as (
    select
      p.id,
      p.name,
      p.brand,
      p.quantity_text,
      p.image_url,
      p.slug,
      p.category_id,
      (
        case
          when p.normalized_name = i.needle then 120
          when p.normalized_name like i.needle || '%' then 100
          when p.normalized_name like '%' || i.needle || '%' then 82
          else 0
        end
        + case
            when unaccent(lower(coalesce(p.brand, ''))) = i.needle then 32
            when unaccent(lower(coalesce(p.brand, ''))) like i.needle || '%' then 20
            else 0
          end
        + similarity(coalesce(p.normalized_name, ''), i.needle) * 55
        + word_similarity(i.needle, coalesce(p.normalized_name, '')) * 40
        + similarity(unaccent(lower(coalesce(p.brand, ''))), i.needle) * 24
      )::double precision as relevance
    from public.products p
    cross join input i
    where p.is_active = true
      and length(i.needle) >= 2
      and (
        p.is_verified = true
        or exists (
          select 1
          from public.offers o
          where o.product_id = p.id
            and o.status = 'published'
            and o.price >= 2
            and o.valid_to >= (now() at time zone 'Europe/Prague')::date
        )
      )
      and (
        coalesce(p.normalized_name, '') % i.needle
        or word_similarity(i.needle, coalesce(p.normalized_name, '')) >= 0.32
        or coalesce(p.normalized_name, '') like '%' || i.needle || '%'
        or unaccent(lower(coalesce(p.brand, ''))) % i.needle
        or unaccent(lower(coalesce(p.brand, ''))) like '%' || i.needle || '%'
      )
  )
  select r.id, r.name, r.brand, r.quantity_text, r.image_url, r.slug, r.category_id, r.relevance
  from ranked r
  order by r.relevance desc, r.name asc
  limit greatest(1, least(coalesce(result_limit, 120), 200));
$$;

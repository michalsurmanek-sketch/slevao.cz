-- Slevao.cz: centrální katalog produktů pro všechny obchody
-- Nabídka (offers) se váže na jeden produkt v products; kvalitní obrázek žije primárně u produktu.

create extension if not exists unaccent;

create or replace function public.normalize_product_name(value text)
returns text
language sql
immutable
parallel safe
as $$
  select trim(regexp_replace(
    lower(unaccent(coalesce(value, ''))),
    '[^a-z0-9]+',
    ' ',
    'g'
  ));
$$;

alter table public.products
  add column if not exists normalized_name text,
  add column if not exists brand text,
  add column if not exists ean text,
  add column if not exists quantity_text text,
  add column if not exists image_source text,
  add column if not exists image_quality smallint not null default 0,
  add column if not exists image_verified boolean not null default false,
  add column if not exists image_checked_at timestamptz;

update public.products
set normalized_name = public.normalize_product_name(name)
where normalized_name is null or normalized_name = '';

create index if not exists products_normalized_name_idx
  on public.products (normalized_name);
create index if not exists products_ean_idx
  on public.products (ean)
  where ean is not null and ean <> '';
create index if not exists products_image_quality_idx
  on public.products (image_quality desc, image_verified)
  where image_url is not null;

create table if not exists public.product_aliases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  brand text,
  quantity_text text,
  source_store_id uuid references public.stores(id) on delete set null,
  confidence numeric(5,4) not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists product_aliases_unique_idx
  on public.product_aliases(product_id, normalized_alias);
create index if not exists product_aliases_lookup_idx
  on public.product_aliases(normalized_alias);

create or replace function public.products_set_normalized_name()
returns trigger
language plpgsql
as $$
begin
  new.normalized_name := public.normalize_product_name(new.name);
  return new;
end;
$$;

drop trigger if exists products_set_normalized_name_trigger on public.products;
create trigger products_set_normalized_name_trigger
before insert or update of name on public.products
for each row execute function public.products_set_normalized_name();

create or replace function public.product_aliases_set_normalized()
returns trigger
language plpgsql
as $$
begin
  new.normalized_alias := public.normalize_product_name(new.alias);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists product_aliases_set_normalized_trigger on public.product_aliases;
create trigger product_aliases_set_normalized_trigger
before insert or update of alias on public.product_aliases
for each row execute function public.product_aliases_set_normalized();

-- Založí aliasy ze stávajících produktů. Opakované spuštění je bezpečné.
insert into public.product_aliases(product_id, alias, normalized_alias, confidence)
select p.id, p.name, public.normalize_product_name(p.name), 1
from public.products p
where public.normalize_product_name(p.name) <> ''
on conflict (product_id, normalized_alias) do nothing;

alter table public.product_aliases enable row level security;
drop policy if exists "public read product aliases" on public.product_aliases;
create policy "public read product aliases"
on public.product_aliases for select
to anon, authenticated
using (true);

-- Service role tabulku spravuje mimo RLS. Administrace ji může číst přes authenticated.
drop policy if exists "staff manage product aliases" on public.product_aliases;
create policy "staff manage product aliases"
on public.product_aliases for all
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor'))
with check ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor'));

-- Nabídky bez vlastní kvalitní fotografie mohou používat master obrázek produktu.
-- Špatné automatické výřezy se tímto odstraní z veřejných nabídek.
update public.offers o
set image_url = p.image_url
from public.products p
where o.product_id = p.id
  and p.image_url is not null
  and coalesce(p.image_quality, 0) >= 70
  and (
    o.image_url is null
    or o.image_url = ''
    or o.image_url like '%/leaflet-crops/%'
  );

update public.offers
set image_url = null
where image_url like '%/leaflet-crops/%';

update public.products
set image_url = null,
    image_source = null,
    image_quality = 0,
    image_verified = false
where image_url like '%/leaflet-crops/%';

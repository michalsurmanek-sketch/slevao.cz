-- Slevao.cz: každá kategorie dostane stabilní a unikátní slug i při vytvoření z administrace.

create or replace function public.slugify_cs(value text)
returns text
language sql
immutable
parallel safe
as $$
  select trim(both '-' from regexp_replace(
    lower(unaccent(coalesce(value, ''))),
    '[^a-z0-9]+',
    '-',
    'g'
  ));
$$;

alter table public.categories
  add column if not exists slug text;

update public.categories
set slug = public.slugify_cs(name)
where coalesce(trim(slug), '') = '';

-- Případné starší shodné slugy bezpečně rozliší krátkou částí UUID.
with duplicates as (
  select id, slug, row_number() over (partition by slug order by id) as position
  from public.categories
  where coalesce(slug, '') <> ''
)
update public.categories c
set slug = c.slug || '-' || left(replace(c.id::text, '-', ''), 6)
from duplicates d
where c.id = d.id and d.position > 1;

create unique index if not exists categories_slug_uidx
  on public.categories(slug)
  where slug is not null and slug <> '';

create or replace function public.categories_assign_slug()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  base_slug text;
begin
  if coalesce(trim(new.slug), '') = '' then
    base_slug := public.slugify_cs(new.name);
    if base_slug = '' then base_slug := 'kategorie'; end if;
    new.slug := base_slug;
    if exists (select 1 from public.categories where slug = new.slug and id <> new.id) then
      new.slug := base_slug || '-' || left(replace(new.id::text, '-', ''), 6);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists categories_assign_slug_trigger on public.categories;
create trigger categories_assign_slug_trigger
before insert or update of name, slug on public.categories
for each row execute function public.categories_assign_slug();

alter table public.categories
  alter column slug set not null;

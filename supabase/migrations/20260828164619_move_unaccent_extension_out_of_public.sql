alter extension unaccent set schema extensions;

create or replace function public.unaccent(value text)
returns text
language sql
stable
strict
parallel safe
set search_path = ''
as $$
  select extensions.unaccent(value)
$$;

create or replace function public.unaccent(dictionary regdictionary, value text)
returns text
language sql
stable
strict
parallel safe
set search_path = ''
as $$
  select extensions.unaccent(dictionary, value)
$$;

revoke all on function public.unaccent(text) from public;
revoke all on function public.unaccent(regdictionary, text) from public;
grant execute on function public.unaccent(text) to anon, authenticated, service_role;
grant execute on function public.unaccent(regdictionary, text) to anon, authenticated, service_role;

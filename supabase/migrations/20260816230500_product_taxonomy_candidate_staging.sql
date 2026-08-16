create table if not exists private.product_taxonomy_candidates (
  product_id uuid primary key references public.products(id) on delete cascade,
  product_name text not null,
  category_slug text not null,
  filter_group text not null,
  filter_tags text[] not null default '{}',
  confidence numeric not null,
  source text not null,
  generated_at timestamptz not null default now()
);

revoke all on table private.product_taxonomy_candidates from public, anon, authenticated;
grant select, insert, update, delete on table private.product_taxonomy_candidates to service_role;

create or replace function private.refresh_product_taxonomy_candidates()
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_count integer;
begin
  delete from private.product_taxonomy_candidates;

  insert into private.product_taxonomy_candidates(product_id, product_name, category_slug, filter_group, filter_tags, confidence, source, generated_at)
  select distinct on (p.id)
    p.id,
    p.name,
    x.category_slug,
    x.filter_group,
    x.filter_tags,
    x.confidence,
    x.source,
    now()
  from public.offers o
  join public.stores s on s.id = o.store_id and s.is_active is true
  join public.products p on p.id = o.product_id and p.is_active is true
  join lateral public.preview_product_taxonomy(p.id) x on true
  where o.status = 'published'
    and o.is_verified is true
    and o.valid_to >= (timezone('Europe/Prague', now()))::date
    and o.valid_from <= (timezone('Europe/Prague', now()))::date + 7
    and x.confidence >= 0.96
  order by p.id, x.confidence desc;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function private.refresh_product_taxonomy_candidates() from public, anon, authenticated;
grant execute on function private.refresh_product_taxonomy_candidates() to service_role;

comment on table private.product_taxonomy_candidates is
  'QA staging only. Candidate classifications are isolated from public products/offers until explicitly approved.';
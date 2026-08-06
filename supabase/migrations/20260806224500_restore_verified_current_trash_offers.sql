create or replace function public.restore_verified_current_trash_offers(
  p_store_slugs text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  restored_count integer := 0;
  duplicate_count integer := 0;
begin
  with candidates as materialized (
    select o.id
    from public.offers o
    join public.stores s on s.id = o.store_id
    where o.status = 'trash'
      and o.valid_to >= current_date
      and (p_store_slugs is null or s.slug = any(p_store_slugs))
      and exists (
        select 1
        from public.leaflet_sources ls
        where ls.store_id = o.store_id
          and ls.is_active = true
      )
      and coalesce((o.metadata ->> '_manual_delete_lock')::boolean, false) = false
      and not exists (
        select 1
        from public.offers published_offer
        where published_offer.status = 'published'
          and published_offer.store_id = o.store_id
          and published_offer.valid_from = o.valid_from
          and published_offer.valid_to = o.valid_to
          and (
            (
              o.product_id is not null
              and published_offer.product_id = o.product_id
            )
            or (
              coalesce(
                published_offer.normalized_title,
                lower(regexp_replace(published_offer.title, '[^[:alnum:]á-žÁ-Ž]+', ' ', 'g'))
              ) = coalesce(
                o.normalized_title,
                lower(regexp_replace(o.title, '[^[:alnum:]á-žÁ-Ž]+', ' ', 'g'))
              )
              and published_offer.price = o.price
            )
          )
      )
  ), restored as (
    update public.offers o
    set status = 'published',
        published_at = coalesce(o.published_at, now()),
        metadata = coalesce(o.metadata, '{}'::jsonb) || jsonb_build_object(
          '_restored_after_verified_source_at', now()
        ),
        updated_at = now()
    from candidates c
    where o.id = c.id
    returning o.id
  )
  select count(*)::integer into restored_count from restored;

  select count(*)::integer
  into duplicate_count
  from public.offers o
  join public.stores s on s.id = o.store_id
  where o.status = 'trash'
    and o.valid_to >= current_date
    and (p_store_slugs is null or s.slug = any(p_store_slugs))
    and coalesce((o.metadata ->> '_manual_delete_lock')::boolean, false) = false
    and exists (
      select 1
      from public.offers published_offer
      where published_offer.status = 'published'
        and published_offer.store_id = o.store_id
        and published_offer.valid_from = o.valid_from
        and published_offer.valid_to = o.valid_to
        and (
          (
            o.product_id is not null
            and published_offer.product_id = o.product_id
          )
          or (
            coalesce(
              published_offer.normalized_title,
              lower(regexp_replace(published_offer.title, '[^[:alnum:]á-žÁ-Ž]+', ' ', 'g'))
            ) = coalesce(
              o.normalized_title,
              lower(regexp_replace(o.title, '[^[:alnum:]á-žÁ-Ž]+', ' ', 'g'))
            )
            and published_offer.price = o.price
          )
        )
    );

  return jsonb_build_object(
    'ok', true,
    'restored_offers', restored_count,
    'duplicate_trash_kept', duplicate_count,
    'verified_stores', coalesce(to_jsonb(p_store_slugs), 'null'::jsonb)
  );
end;
$$;

create or replace function public.restore_trash_after_verified_leaflet_source()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  store_slug text;
begin
  if new.is_active = true
     and new.last_success_at is not null
     and new.last_strategy_used in ('specialized-verified', 'generic-verified')
     and (
       old.last_success_at is distinct from new.last_success_at
       or old.last_strategy_used is distinct from new.last_strategy_used
     ) then
    select s.slug into store_slug
    from public.stores s
    where s.id = new.store_id;

    if store_slug is not null then
      perform public.restore_verified_current_trash_offers(array[store_slug]);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_restore_trash_after_verified_leaflet_source
on public.leaflet_sources;

create trigger trg_restore_trash_after_verified_leaflet_source
after update of last_success_at, last_strategy_used
on public.leaflet_sources
for each row
execute function public.restore_trash_after_verified_leaflet_source();

revoke all on function public.restore_verified_current_trash_offers(text[]) from public, anon, authenticated;
grant execute on function public.restore_verified_current_trash_offers(text[]) to service_role;

create or replace function public.infer_product_filter_group_source_rules_v33(p_name text, p_quantity_text text default null, p_metadata jsonb default '{}'::jsonb)
returns text
language plpgsql
stable parallel safe
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(p_name,''));
begin
  if coalesce(p_metadata->>'source_dm_context','false')='true' then
    if n ~ '(^| )ochranny plast( |$)' then return 'toys'; end if;
    if n ~ 'sada na tvoreni a zdobeni' then return 'home'; end if;
    if n ~ 'odsavacce mleka|odsavacka mleka' then return 'drugstore'; end if;
  end if;
  if lower(coalesce(p_metadata->>'source_store_slug',''))='pilulka' then return 'other'; end if;
  return public.infer_product_filter_group_source_rules(p_name,p_quantity_text,p_metadata);
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer language sql immutable parallel safe
set search_path to 'public','pg_temp'
as $function$ select 69 $function$;

create or replace function public.sync_dm_product_context_from_offer()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare v_slug text;
begin
  if new.product_id is null or new.store_id is null or new.status <> 'published' or coalesce(new.is_verified,false) is false then return new; end if;
  select slug into v_slug from public.stores where id=new.store_id;
  if v_slug='dm' then
    update public.products p
    set metadata=coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
      'source_dm_context',true,
      'source_dm_context_source','verified-dm-offer-v69',
      'source_dm_context_checked_at',now()
    )
    where p.id=new.product_id and coalesce(p.metadata->>'source_dm_context','false')<>'true';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_sync_dm_product_context_from_offer on public.offers;
create trigger trg_sync_dm_product_context_from_offer
after insert or update of product_id,store_id,status,is_verified on public.offers
for each row execute function public.sync_dm_product_context_from_offer();

update public.products p
set metadata=coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
  'source_dm_context',true,
  'source_dm_context_source','verified-dm-offer-v69',
  'source_dm_context_checked_at',now()
)
where exists (
  select 1 from public.offers o join public.stores s on s.id=o.store_id
  where o.product_id=p.id and s.slug='dm' and o.status='published' and o.is_verified=true
    and o.valid_from <= (now() at time zone 'Europe/Prague')::date
    and o.valid_to >= (now() at time zone 'Europe/Prague')::date
);
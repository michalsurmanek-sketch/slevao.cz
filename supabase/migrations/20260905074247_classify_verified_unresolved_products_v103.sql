create or replace function public.guard_verified_unresolved_products_v103()
returns trigger
language plpgsql
security invoker
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(new.name,''));
  src text := lower(trim(coalesce(new.metadata->>'source_store_slug','')));
  v_group text;
  v_category_slug text;
  v_tag text;
  v_category_id uuid;
begin
  if coalesce(new.metadata->>'filter_group_source','')='explicit' then return new; end if;
  if coalesce(nullif(trim(new.filter_group),''),'other') <> 'other' then return new; end if;

  if src='globus' and n ~ '(^| )rio 214( |$)' and lower(trim(coalesce(new.brand,'')))='evona' then
    v_group:='fashion'; v_category_slug:='moda'; v_tag:='moda';
  elsif src='globus' and n ~ '(^| )allnature draci krev 30 ml( |$)' then
    v_group:='pharmacy'; v_category_slug:='lekarna'; v_tag:='lekarna';
  elsif src='globus' and n ~ '(^| )organis supergreen mix 30 davek 165 g( |$)' then
    v_group:='pharmacy'; v_category_slug:='lekarna'; v_tag:='lekarna';
  elsif src='globus' and n ~ '(^| )swastha amurtha 7 x 4g( |$)' then
    v_group:='drinks'; v_category_slug:='napoje'; v_tag:='napoje';
  elsif src='rohlik' and n ~ '(^| )pappudia granatova bomba( |$)' then
    v_group:='food'; v_category_slug:='ovoce-zelenina'; v_tag:='ovoce-zelenina';
  elsif src='kaufland' and n ~ '(^| )k classic hp pena( |$)' then
    v_group:='food'; v_category_slug:='mlecne-vyrobky'; v_tag:='mlecne';
  elsif src='flop' and n ~ '(^| )flora 225 g( |$)' then
    v_group:='food'; v_category_slug:='mlecne-vyrobky'; v_tag:='mlecne';
  elsif src='kaufland' and n ~ '(^| )adidas batoh 28 l( |$)' then
    v_group:='fashion'; v_category_slug:='moda'; v_tag:='moda';
  elsif src='kaufland' and n='xtra' and coalesce(new.metadata->>'kaufland_kl_nr','')='20902711' then
    v_group:='fashion'; v_category_slug:='moda'; v_tag:='moda';
  else
    return new;
  end if;

  select id into v_category_id
  from public.categories
  where slug=v_category_slug and is_active is true
  limit 1;

  if v_category_id is not null then new.category_id:=v_category_id; end if;
  new.filter_group:=v_group;
  if v_tag is not null and not (v_tag=any(coalesce(new.filter_tags,'{}'::text[]))) then
    new.filter_tags:=array_append(coalesce(new.filter_tags,'{}'::text[]),v_tag);
  end if;
  new.classification_confidence:=greatest(coalesce(new.classification_confidence,0),0.999);
  new.classification_source:='verified-unresolved-v103';
  new.classified_at:=now();
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
    'filter_group_source','auto_classifier',
    'verified_unresolved_guard','v103',
    'verified_unresolved_guard_at',now()
  );
  return new;
end;
$function$;

revoke execute on function public.guard_verified_unresolved_products_v103() from public, anon, authenticated;

drop trigger if exists zzzzz_unresolved_verified_guard_v103 on public.products;
create trigger zzzzz_unresolved_verified_guard_v103
before insert or update of name, brand, category_id, quantity_text, filter_group, metadata
on public.products
for each row
execute function public.guard_verified_unresolved_products_v103();

update public.products
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('verified_unresolved_recheck_at',now())
where coalesce(nullif(trim(filter_group),''),'other')='other'
  and (
    (lower(trim(coalesce(metadata->>'source_store_slug','')))='globus' and public.normalize_text(coalesce(name,'')) ~ '(^| )(rio 214|allnature draci krev 30 ml|organis supergreen mix 30 davek 165 g|swastha amurtha 7 x 4g)( |$)')
    or (lower(trim(coalesce(metadata->>'source_store_slug','')))='rohlik' and public.normalize_text(coalesce(name,'')) ~ '(^| )pappudia granatova bomba( |$)')
    or (lower(trim(coalesce(metadata->>'source_store_slug','')))='kaufland' and public.normalize_text(coalesce(name,'')) ~ '(^| )(k classic hp pena|adidas batoh 28 l)( |$)')
    or (lower(trim(coalesce(metadata->>'source_store_slug','')))='kaufland' and public.normalize_text(coalesce(name,''))='xtra' and coalesce(metadata->>'kaufland_kl_nr','')='20902711')
    or (lower(trim(coalesce(metadata->>'source_store_slug','')))='flop' and public.normalize_text(coalesce(name,'')) ~ '(^| )flora 225 g( |$)')
  );
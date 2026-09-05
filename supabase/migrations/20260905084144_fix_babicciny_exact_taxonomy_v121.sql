create or replace function public.guard_safe_food_subcategory_v121_exact_fallback()
returns trigger
language plpgsql
security invoker
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(new.name,''));
  v_category_id uuid;
begin
  if new.filter_group is distinct from 'food' or new.category_id is not null then return new; end if;
  if n <> 'babicciny valcovane 330 g' then return new; end if;

  select id into v_category_id
  from public.categories
  where slug='trvanlive-potraviny' and is_active is true
  limit 1;
  if v_category_id is null then return new; end if;

  new.category_id:=v_category_id;
  if not ('trvanlive'=any(coalesce(new.filter_tags,'{}'::text[]))) then
    new.filter_tags:=array_append(coalesce(new.filter_tags,'{}'::text[]),'trvanlive');
  end if;
  new.classification_confidence:=greatest(coalesce(new.classification_confidence,0),0.999);
  new.classification_source:='verified-exact-food-guard-v121';
  new.classified_at:=now();
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
    'verified_exact_food_guard','v121',
    'verified_exact_food_guard_slug','trvanlive-potraviny',
    'verified_exact_food_guard_at',now()
  );
  return new;
end;
$function$;

revoke execute on function public.guard_safe_food_subcategory_v121_exact_fallback() from public, anon, authenticated;

drop trigger if exists zzzzzzzzzzzzz_safe_food_subcategory_v121_exact_fallback on public.products;
create trigger zzzzzzzzzzzzz_safe_food_subcategory_v121_exact_fallback
before insert or update of name, brand, category_id, quantity_text, filter_group, metadata
on public.products
for each row execute function public.guard_safe_food_subcategory_v121_exact_fallback();

update public.products
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('current_v121_recheck_at',now())
where filter_group='food' and category_id is null
  and public.normalize_text(name)='babicciny valcovane 330 g';
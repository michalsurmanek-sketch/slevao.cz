create or replace function public.guard_filter_group_v117_false_food_additions()
returns trigger
language plpgsql
security invoker
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(new.name,''));
  src text := lower(trim(coalesce(new.metadata->>'source_store_slug','')));
  v_category_id uuid;
  v_group text;
  v_slug text;
  v_tag text;
begin
  if coalesce(new.metadata->>'filter_group_source','')='explicit' then return new; end if;
  if new.filter_group is distinct from 'food' then return new; end if;

  if src='globus' and n='sodastream art black malina zero mpack' then
    v_group:='home'; v_slug:='domacnost'; v_tag:='domacnost';
  elsif src='globus' and n ~ '^vina tarapaca syrah 750 ml$' then
    v_group:='drinks'; v_slug:='napoje'; v_tag:='napoje';
  else
    return new;
  end if;

  select id into v_category_id from public.categories where slug=v_slug and is_active is true limit 1;
  new.filter_group:=v_group;
  if v_category_id is not null then new.category_id:=v_category_id; end if;
  new.filter_tags:=array_remove(array_remove(array_remove(coalesce(new.filter_tags,'{}'::text[]),'food'),'trvanlive'),'trvanlive-potraviny');
  if not (v_tag=any(coalesce(new.filter_tags,'{}'::text[]))) then new.filter_tags:=array_append(coalesce(new.filter_tags,'{}'::text[]),v_tag); end if;
  new.classification_confidence:=greatest(coalesce(new.classification_confidence,0),0.999);
  new.classification_source:='filter-group-guard-v117';
  new.classified_at:=now();
  new.metadata:=(coalesce(new.metadata,'{}'::jsonb)-'food_subcategory_guard'-'food_subcategory_guard_slug'-'food_subcategory_guard_at')
    || jsonb_build_object('filter_group_source','auto_classifier','filter_group_guard','v117','filter_group_guard_at',now());
  return new;
end;
$function$;

revoke execute on function public.guard_filter_group_v117_false_food_additions() from public, anon, authenticated;

drop trigger if exists zzzz_filter_group_v117_false_food_additions on public.products;
create trigger zzzz_filter_group_v117_false_food_additions
before insert or update of name, brand, category_id, quantity_text, filter_group, metadata
on public.products
for each row execute function public.guard_filter_group_v117_false_food_additions();

update public.products
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('current_v117_recheck_at',now())
where filter_group='food'
  and lower(trim(coalesce(metadata->>'source_store_slug','')))='globus'
  and public.normalize_text(name) in ('sodastream art black malina zero mpack','vina tarapaca syrah 750 ml');
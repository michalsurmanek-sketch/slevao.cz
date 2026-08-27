create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable
parallel safe
as $$ select 1; $$;

create or replace function public.infer_product_filter_group_auto(
  p_name text,
  p_category_id uuid default null,
  p_quantity_text text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare
  v_category_slug text;
  v_group text;
  v_tags text[] := '{}'::text[];
  v_search text := concat_ws(' ',coalesce(p_name,''),coalesce(p_quantity_text,''));
begin
  if p_category_id is not null then
    select c.slug into v_category_slug from public.categories c where c.id=p_category_id;
  end if;

  v_group := public.infer_public_filter_group(p_name,v_category_slug);
  if v_group is not null and v_group <> 'other' then
    return v_group;
  end if;

  v_tags := public.public_offer_semantic_tags(v_search);

  if v_tags && array['beer','beer_lager','beer_draught','beer_nonalc','beer_radler','fruit_drink','plant_drink']::text[] then
    return 'drinks';
  end if;

  if v_tags && array[
    'milk','bread','buns','sweet_bakery','bread_fresh','bread_packaged','bread_gluten_free','rolls','loaf','baguette',
    'eggs','butter','cheese','eidam','gouda','meat','chicken','pork_neck','pork','beef','turkey','minced_meat','meat_fresh','meat_frozen','marinated_meat',
    'fish','cold_cuts','fruit_fresh','apples','bananas','fruit_citrus','fruit_berries','fruit_exotic','fruit_frozen','fruit_dried',
    'veg_fresh','peppers','onions','leafy_veg','veg_products','root_veg','potatoes','tomatoes','veg_frozen','veg_preserved'
  ]::text[] then
    return 'food';
  end if;

  return 'other';
end;
$$;

create or replace function public.auto_assign_product_filter_group()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
  v_inferred text;
  v_version integer := public.product_filter_group_classifier_version();
  v_old_auto boolean := false;
  v_new_auto boolean := false;
  v_explicit_change boolean := false;
begin
  if tg_op='UPDATE' then
    v_old_auto := coalesce(old.metadata->>'filter_group_source','')='auto_classifier';
    v_explicit_change := new.filter_group is distinct from old.filter_group
      and coalesce(nullif(trim(new.filter_group),''),'other') <> 'other';
  end if;

  v_new_auto := coalesce(new.metadata->>'filter_group_source','')='auto_classifier';

  if v_explicit_change then
    new.metadata := coalesce(new.metadata,'{}'::jsonb) - 'filter_group_source' - 'filter_group_classifier_version';
    return new;
  end if;

  if coalesce(nullif(trim(new.filter_group),''),'other')='other' or v_old_auto or v_new_auto then
    v_inferred := public.infer_product_filter_group_auto(new.name,new.category_id,new.quantity_text,new.metadata);

    if v_inferred <> 'other' then
      new.filter_group := v_inferred;
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
        'filter_group_source','auto_classifier',
        'filter_group_classifier_version',v_version
      );
    elsif v_old_auto or v_new_auto then
      new.filter_group := 'other';
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
        'filter_group_source','auto_classifier',
        'filter_group_classifier_version',v_version
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists auto_assign_product_filter_group_trg on public.products;
create trigger auto_assign_product_filter_group_trg
before insert or update of name, category_id, quantity_text, filter_group, metadata
on public.products
for each row execute function public.auto_assign_product_filter_group();

create or replace function private.auto_reclassify_products(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
set statement_timeout to '30s'
as $$
declare
  v_limit integer := greatest(1,least(coalesce(p_limit,500),2000));
  v_version integer := public.product_filter_group_classifier_version();
  v_scanned integer := 0;
  v_changed integer := 0;
begin
  with candidates as (
    select p.id,
           public.infer_product_filter_group_auto(p.name,p.category_id,p.quantity_text,p.metadata) as inferred
    from public.products p
    where p.is_active=true
      and (
        coalesce(nullif(trim(p.filter_group),''),'other')='other'
        or (
          coalesce(p.metadata->>'filter_group_source','')='auto_classifier'
          and coalesce(nullif(p.metadata->>'filter_group_classifier_version','')::integer,0) < v_version
        )
      )
    order by p.updated_at nulls first,p.created_at,p.id
    limit v_limit
    for update skip locked
  ), stats as (
    select count(*)::integer as cnt from candidates
  ), changed as (
    update public.products p
       set filter_group=c.inferred,
           metadata=coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
             'filter_group_source','auto_classifier',
             'filter_group_classifier_version',v_version
           ),
           updated_at=now()
      from candidates c
     where p.id=c.id
       and c.inferred <> 'other'
    returning p.id
  )
  select s.cnt,(select count(*)::integer from changed)
    into v_scanned,v_changed
  from stats s;

  return jsonb_build_object(
    'ok',true,
    'classifier_version',v_version,
    'scanned',coalesce(v_scanned,0),
    'changed',coalesce(v_changed,0)
  );
end;
$$;

revoke all on function private.auto_reclassify_products(integer) from public;

DO $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='slevao-auto-reclassify-products' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'slevao-auto-reclassify-products',
    '37 * * * *',
    'select private.auto_reclassify_products(500);'
  );
end $$;

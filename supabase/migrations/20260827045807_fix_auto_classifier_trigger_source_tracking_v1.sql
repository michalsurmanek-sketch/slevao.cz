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
  v_new_auto := coalesce(new.metadata->>'filter_group_source','')='auto_classifier';

  if tg_op='UPDATE' then
    v_old_auto := coalesce(old.metadata->>'filter_group_source','')='auto_classifier';
    v_explicit_change := new.filter_group is distinct from old.filter_group
      and coalesce(nullif(trim(new.filter_group),''),'other') <> 'other'
      and not v_new_auto;
  end if;

  if v_explicit_change then
    new.metadata := coalesce(new.metadata,'{}'::jsonb)
      - 'filter_group_source'
      - 'filter_group_classifier_version';
    return new;
  end if;

  if coalesce(nullif(trim(new.filter_group),''),'other')='other' or v_old_auto or v_new_auto then
    v_inferred := public.infer_product_filter_group_auto(new.name,new.category_id,new.quantity_text,new.metadata);

    if v_inferred <> 'other' then
      new.filter_group := v_inferred;
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
        'filter_group_source','auto_classifier',
        'filter_group_classifier_version',v_version,
        'filter_group_classifier_checked_version',v_version,
        'filter_group_classifier_checked_at',now()
      );
    elsif v_old_auto or v_new_auto then
      new.filter_group := 'other';
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
        'filter_group_source','auto_classifier',
        'filter_group_classifier_version',v_version,
        'filter_group_classifier_checked_version',v_version,
        'filter_group_classifier_checked_at',now()
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists auto_assign_product_filter_group_trg on public.products;
drop trigger if exists zz_auto_assign_product_filter_group_trg on public.products;
create trigger zz_auto_assign_product_filter_group_trg
before insert or update of name, category_id, quantity_text, filter_group, metadata
on public.products
for each row execute function public.auto_assign_product_filter_group();

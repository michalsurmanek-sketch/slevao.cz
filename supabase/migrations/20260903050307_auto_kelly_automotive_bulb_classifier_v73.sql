create or replace function public.infer_product_filter_group_auto_kelly_context_v73(p_name text, p_quantity_text text)
returns text
language plpgsql
stable parallel safe
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(p_name,''));
begin
  if n ~ '[0-9]+ah.*12v' then return 'auto'; end if;
  if n ~ '(ochranny nastrik|opravu plast|drzak ramecku na registracni znacku|montazni kit thule)' then return 'auto'; end if;
  if n ~ '(^| )(zarovka|auto zarovka)( |$)' and n ~ '(^| )(h[1-9][0-9]?|12v|24v|osram|philips)( |$)' then return 'auto'; end if;
  if n ~ '(^| )dres( |$)' then return 'fashion'; end if;
  if n ~ '(rychlocistic|cistic raf|cistic brzd|odmast)' then return 'drugstore'; end if;
  return 'other';
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable parallel safe
set search_path to 'public','pg_temp'
as $function$ select 73 $function$;

do $patch$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.auto_assign_product_filter_group()'::regprocedure);
  v_new := replace(v_def,'public.infer_product_filter_group_auto_kelly_context_v72(new.name,new.quantity_text)','public.infer_product_filter_group_auto_kelly_context_v73(new.name,new.quantity_text)');
  if v_new=v_def then raise exception 'v73 patch failed at Auto Kelly inference'; end if;
  v_def := v_new;
  v_new := replace(v_def,'''auto-kelly-context-v72''','''auto-kelly-context-v73''');
  if v_new=v_def then raise exception 'v73 patch failed at Auto Kelly source'; end if;
  execute v_new;
end;
$patch$;

update public.products p
set metadata=coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object('filter_group_classifier_checked_version',0)
where p.id in (
  select distinct o.product_id
  from public.offers o
  join public.stores st on st.id=o.store_id
  where st.slug='auto-kelly'
    and o.status='published' and o.is_verified=true
    and o.valid_from <= (now() at time zone 'Europe/Prague')::date
    and o.valid_to >= (now() at time zone 'Europe/Prague')::date
)
and coalesce(p.metadata->>'filter_group_source','')='auto_classifier';

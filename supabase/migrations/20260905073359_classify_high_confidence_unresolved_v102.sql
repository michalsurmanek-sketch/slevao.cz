create or replace function public.guard_high_confidence_unresolved_v102()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(new.name,''));
  src text := lower(trim(coalesce(new.metadata->>'source_store_slug','')));
  v_group text;
  v_category_slug text;
  v_tag text;
  v_category_id uuid;
  v_version integer := public.product_filter_group_classifier_version();
begin
  if coalesce(new.metadata->>'filter_group_source','')='explicit' then return new; end if;
  if coalesce(nullif(trim(new.filter_group),''),'other') <> 'other' then return new; end if;

  if src='auto-kelly' then
    v_group:='auto'; v_category_slug:='auto'; v_tag:='auto';
  elsif src in ('ikea','xxxlutz') then
    v_group:='home'; v_category_slug:='domacnost'; v_tag:='domacnost';
  elsif src='action' and n ~ '(^| )bambusovy vozik( |$)' then
    v_group:='home'; v_category_slug:='domacnost'; v_tag:='domacnost';
  elsif src='action' and n ~ '(^| )fuggler( |$)' then
    v_group:='toys';
  elsif src='action' and n ~ '(^| )luxusni diar( |$)' then
    v_group:='school';
  elsif src='dm' and n ~ '(^| )(pecujici krem|trpytive tetovani|turban na vlasy)( |$)' then
    v_group:='drugstore'; v_category_slug:='drogerie'; v_tag:='drogerie';
  elsif src='globus' and n ~ '(^| )privesek reflexni ctyrlistek( |$)' then
    v_group:='auto'; v_category_slug:='auto'; v_tag:='auto';
  elsif src='hruska' and n ~ '(^| )airwaves( |$)' then
    v_group:='food'; v_category_slug:='sladkosti'; v_tag:='sladkosti';
  elsif src='hruska' and n ~ '(^| )lipno( |$)' then
    v_group:='food'; v_category_slug:='mlecne-vyrobky'; v_tag:='mlecne';
  elsif src='kaufland' and n ~ '(^| )discreet( |$)' then
    v_group:='drugstore'; v_category_slug:='drogerie'; v_tag:='drogerie';
  elsif src='kaufland' and n ~ '(^| )energizer baterie (aa|aaa)( |$)' then
    v_group:='electronics'; v_category_slug:='elektronika'; v_tag:='elektronika';
  elsif src='kaufland' and n ~ '(^| )gerber kapsicka( |$)' then
    v_group:='food'; v_category_slug:='trvanlive-potraviny'; v_tag:='trvanlive';
  elsif src='kaufland' and n ~ '(^| )movenpick( |$)' and coalesce(new.metadata->>'source_category_root','') ilike '%Káva%' then
    v_group:='drinks'; v_category_slug:='napoje'; v_tag:='napoje';
  elsif src='kaufland' and n ~ '(^| )parkside pasek( |$)' then
    v_group:='fashion'; v_category_slug:='moda'; v_tag:='moda';
  elsif src='kaufland' and n ~ '(^| )tuc krekry( |$)' then
    v_group:='food'; v_category_slug:='trvanlive-potraviny'; v_tag:='trvanlive';
  elsif src='kosik' and n ~ '(^| )agro kristalon( |$)' then
    v_group:='garden'; v_category_slug:='zahrada'; v_tag:='zahrada';
  elsif src='kosik' and n ~ '(^| )fazolove lusky( |$)' then
    v_group:='food'; v_category_slug:='ovoce-zelenina'; v_tag:='ovoce-zelenina';
  elsif src='kosik' and n ~ '(^| )nohel garden minipareniste( |$)' then
    v_group:='garden'; v_category_slug:='zahrada'; v_tag:='zahrada';
  elsif src='lidl' and n ~ '(^| )(argus 12 maestic|bitterol)( |$)' then
    v_group:='drinks'; v_category_slug:='napoje'; v_tag:='napoje';
  elsif src='lidl' and n ~ '(^| )ferrero collection( |$)' then
    v_group:='food'; v_category_slug:='sladkosti'; v_tag:='sladkosti';
  elsif src='lidl' and n ~ '(^| )havlik pohodovky( |$)' then
    v_group:='food'; v_category_slug:='trvanlive-potraviny'; v_tag:='trvanlive';
  elsif src='norma' and n ~ '(^| )kosicky med fruits( |$)' then
    v_group:='food'; v_category_slug:='trvanlive-potraviny'; v_tag:='trvanlive';
  elsif src='rohlik' and n ~ '(^| )focaccina s rozmarynem( |$)' then
    v_group:='food'; v_category_slug:='pecivo'; v_tag:='pecivo';
  else
    return new;
  end if;

  if v_category_slug is not null then
    select id into v_category_id from public.categories where slug=v_category_slug and is_active is true limit 1;
    if v_category_id is not null then new.category_id:=v_category_id; end if;
  end if;
  new.filter_group:=v_group;
  if v_tag is not null and not (v_tag=any(coalesce(new.filter_tags,'{}'::text[]))) then
    new.filter_tags:=array_append(coalesce(new.filter_tags,'{}'::text[]),v_tag);
  end if;
  new.classification_confidence:=greatest(coalesce(new.classification_confidence,0),0.995);
  new.classification_source:='unresolved-guard-v102';
  new.classified_at:=now();
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
    'filter_group_source','auto_classifier',
    'filter_group_classifier_version',v_version,
    'filter_group_classifier_checked_version',v_version,
    'filter_group_classifier_checked_at',now(),
    'unresolved_filter_group_guard','v102'
  );
  return new;
end;
$function$;

drop trigger if exists zzzz_unresolved_filter_group_guard_v102 on public.products;
create trigger zzzz_unresolved_filter_group_guard_v102
before insert or update of name,brand,category_id,quantity_text,filter_group,metadata
on public.products
for each row execute function public.guard_high_confidence_unresolved_v102();

with today as (select (timezone('Europe/Prague',now()))::date d), picked as (
  select distinct p.id
  from public.offers o join public.products p on p.id=o.product_id cross join today
  where o.status='published' and o.is_verified is true
    and o.valid_from<=today.d and o.valid_to>=today.d
    and p.filter_group is null
)
update public.products p set metadata=p.metadata from picked x where p.id=x.id;
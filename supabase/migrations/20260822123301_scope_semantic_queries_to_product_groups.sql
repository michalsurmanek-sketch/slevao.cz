create or replace function public.public_semantic_tag_filter_group(p_tag text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
select case
  when p_tag in ('beer','fruit_drink') then 'drinks'
  when p_tag in (
    'milk','bread','rolls','loaf','baguette','eggs','butter','cheese','eidam','gouda',
    'meat','chicken','pork_neck','pork','beef',
    'fruit_fresh','apples','bananas','fruit_frozen','fruit_dried',
    'veg_fresh','potatoes','tomatoes','veg_frozen','veg_preserved'
  ) then 'food'
  else null
end;
$function$;

revoke all on function public.public_semantic_tag_filter_group(text) from public;
grant execute on function public.public_semantic_tag_filter_group(text) to anon, authenticated, service_role;

do $migration$
declare
  fn text;
  semantic_needle text := 'public.public_semantic_query_tag(p_query) semantic_tag';
  semantic_replacement text := 'public.public_semantic_query_tag(p_query) semantic_tag,' || chr(10) ||
    '         public.public_semantic_tag_filter_group(public.public_semantic_query_tag(p_query)) semantic_group';
  group_needle text := '(x.filter_group is null or c.effective_filter_group=x.filter_group)';
  group_replacement text := group_needle || ' and (x.semantic_group is null or c.effective_filter_group=x.semantic_group)';
  sig regprocedure;
begin
  foreach sig in array array[
    'public.get_public_offer_page_filtered(integer,integer,boolean,text,numeric,numeric,boolean,text,text,text,text,text,text)'::regprocedure,
    'public.get_public_saved_offer_page(uuid[],integer,integer,text,numeric,numeric,boolean,text,text,text,text,text)'::regprocedure
  ] loop
    fn := pg_get_functiondef(sig);
    if position(semantic_needle in fn)=0 or position(group_needle in fn)=0 then
      raise exception 'semantic group guard missing in %', sig;
    end if;
    if position('semantic_group' in fn)>0 then
      raise exception 'semantic group already present in %', sig;
    end if;
    fn := replace(fn,semantic_needle,semantic_replacement);
    fn := replace(fn,group_needle,group_replacement);
    execute fn;
  end loop;
end;
$migration$;

do $migration$
declare
  fn text := pg_get_functiondef('public.get_public_offer_facets(boolean,text,numeric,numeric,boolean,text,text,text,text,text)'::regprocedure);
  semantic_needle text := 'public.public_semantic_query_tag(p_query) semantic_tag';
  semantic_replacement text := 'public.public_semantic_query_tag(p_query) semantic_tag,' || chr(10) ||
    '         public.public_semantic_tag_filter_group(public.public_semantic_query_tag(p_query)) semantic_group';
  image_needle text := '(x.only_images is false or c.image_url is not null)';
  image_replacement text := image_needle || ' and (x.semantic_group is null or c.effective_filter_group=x.semantic_group)';
begin
  if position(semantic_needle in fn)=0 or position(image_needle in fn)=0 then
    raise exception 'facet semantic group guard missing';
  end if;
  if position('semantic_group' in fn)>0 then
    raise exception 'semantic group already present in facets';
  end if;
  fn := replace(fn,semantic_needle,semantic_replacement);
  fn := replace(fn,image_needle,image_replacement);
  execute fn;
end;
$migration$;
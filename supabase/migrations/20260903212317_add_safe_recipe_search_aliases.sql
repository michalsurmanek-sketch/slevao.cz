create or replace function public.get_public_shopping_list_candidates(
  p_queries text[],
  p_limit_per_query integer default 30
)
returns table(
  query_text text,
  query_key text,
  candidate_rank integer,
  offer jsonb,
  total_count bigint
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  rec record;
begin
  for rec in
    select
      q.query_text,
      q.base_text as ingredient_text,
      case lower(public.unaccent(q.base_text))
        when 'olej na smazeni' then 'Olej'
        when 'marmelada' then 'Džem'
        when 'hovezi maso' then 'Hovězí zadní'
        when 'hladka mouka' then 'Pšeničná mouka'
        else q.base_text
      end as search_text,
      q.query_text ~* '[[:space:]]*\([[:space:]]*[0-9]+([.,][0-9]+)?[[:space:]]+(kg|g|ml|l|ks|balení|stroužky)[[:space:]]*\)[[:space:]]*$' as is_recipe,
      q.query_ord
    from (
      select btrim(value) as query_text,
        coalesce(nullif(btrim(regexp_replace(btrim(value), '[[:space:]]*\([[:space:]]*[0-9]+([.,][0-9]+)?[[:space:]]+(kg|g|ml|l|ks|balení|stroužky)[[:space:]]*\)[[:space:]]*$', '', 'i')), ''), btrim(value)) as base_text,
        ordinality as query_ord
      from unnest(coalesce(p_queries, array[]::text[])) with ordinality as u(value, ordinality)
    ) q
    where q.query_text <> '' order by q.query_ord
  loop
    return query
    with raw as (
      select page_row.offer,page_row.total_count,page_row.candidate_ord::integer as candidate_ord
      from public.get_public_offer_page_filtered(
        p_limit=>greatest(1,least(greatest(coalesce(p_limit_per_query,30),20)*2,60)),p_offset=>0,p_include_upcoming=>true,
        p_store_slug=>null,p_min_price=>null,p_max_price=>null,p_only_images=>false,p_sort=>'recommended',p_query=>rec.search_text,
        p_filter_group=>null,p_region_code=>null,p_city_name=>null,p_mode=>'all'
      ) with ordinality as page_row(offer,total_count,candidate_ord)
    ),
    query_tokens as (
      select token from unnest(regexp_split_to_array(lower(public.unaccent(rec.search_text)), '[^a-z0-9]+')) as token
      where length(token)>=3 and token not in ('smazeni')
    ),
    scored as (
      select r.*,
        lower(public.unaccent(concat_ws(' ',r.offer->>'title',r.offer->'products'->>'name'))) as candidate_text,
        lower(public.unaccent(concat_ws(' ',r.offer->'metadata'->>'kaufland_category_name',r.offer->'metadata'->>'source_category_path',r.offer->'metadata'->>'category',r.offer->'categories'->>'name'))) as context_text,
        lower(public.unaccent(coalesce(r.offer->>'description',''))) as description_text,
        (select count(*) from query_tokens) as token_count,
        (select count(*) from query_tokens q where exists (
          select 1 from unnest(regexp_split_to_array(lower(public.unaccent(concat_ws(' ',r.offer->>'title',r.offer->'products'->>'name'))),'[^a-z0-9]+')) as ctok
          where length(ctok)>=3 and left(ctok,case when length(q.token)<=4 then 3 else 4 end)=left(q.token,case when length(q.token)<=4 then 3 else 4 end)
        )) as stem_count,
        (select count(*) from query_tokens q where exists (
          select 1 from unnest(regexp_split_to_array(lower(public.unaccent(concat_ws(' ',r.offer->>'title',r.offer->'products'->>'name'))),'[^a-z0-9]+')) as ctok where ctok=q.token
        )) as exact_count
      from raw r
    ),
    eligible_base as (
      select s.* from scored s
      where not rec.is_recipe or (
        coalesce(s.offer->'products'->>'filter_group','')='food'
        and s.stem_count=s.token_count
        and s.context_text !~ '(detska vyziva|kojeneck|krmiv)'
        and s.candidate_text !~ '(^| )(dog|cat|psi|kocici|krmiv)[a-z]*( |$)'
        and not (lower(public.unaccent(rec.search_text)) like '%hovezi%' and s.candidate_text ~ '(^| )(veprov|kurec|kruti|kachn|jehne|ryb)[a-z]*( |$)')
        and (lower(public.unaccent(rec.ingredient_text)) <> 'hovezi maso' or s.candidate_text !~ '(mlet|meln|burger|tatarak)')
        and (lower(public.unaccent(rec.ingredient_text)) <> 'hladka mouka' or (
          s.candidate_text !~ '(spald|zitn|celozrnn|bezlepk|hrub|polohrub)'
          and s.description_text ~ '(^| )hladka( |$)'
        ))
        and (lower(public.unaccent(rec.ingredient_text)) <> 'sadlo' or (s.candidate_text !~ 'bez kuze' and s.context_text !~ 'maso a ryby'))
        and (lower(public.unaccent(rec.ingredient_text)) <> 'strouhanka' or s.candidate_text !~ '(panko|japonsk)')
        and (lower(public.unaccent(rec.ingredient_text)) <> 'parmazan' or s.candidate_text !~ '(a la parmazan|styl parmazan)')
        and (lower(public.unaccent(rec.ingredient_text)) not in ('brambory','cibule','cesnek','mrkev') or (
          exists (select 1 from unnest(regexp_split_to_array(s.candidate_text,'[^a-z0-9]+')) with ordinality as ctok(token,ord) where ctok.ord<=3 and ctok.token=lower(public.unaccent(rec.ingredient_text)))
          and s.candidate_text !~ '(sazeck|sadbov|osiv|semen|medvedi|tofu|krevety|pomazank|baget|bramborov|gnocchi|bramborak|kase|varene|loupane)'
        ))
        and (lower(public.unaccent(rec.ingredient_text)) <> 'mleko' or s.candidate_text !~ '(kefir|acidofil|detske|kojeneck|beba|smetana)')
        and (lower(public.unaccent(rec.ingredient_text)) not in ('olej','olej na smazeni') or (
          s.candidate_text ~ '(slunecnic|repk|rostlinn|frit)'
          and lower(public.unaccent(coalesce(s.offer->'products'->>'quantity_text',''))) ~ '[0-9]+([.,][0-9]+)?[[:space:]]*(ml|l)([^a-z]|$)'
        ))
      )
    ),
    eligible as (select e.*,max(e.exact_count) over() as max_exact_count from eligible_base e),
    amount_parsed as (
      select e.*,parsed.req,parsed.pkg,lower(coalesce(e.offer->'products'->>'quantity_text','')) like '%cena za%' as variable_price
      from eligible e cross join lateral (
        select regexp_match(rec.query_text,'\(([0-9]+([.,][0-9]+)?)\s*(kg|g|ml|l|ks)\)\s*$','i') as req,
               regexp_match(coalesce(e.offer->'products'->>'quantity_text',''),'([0-9]+([.,][0-9]+)?)\s*(kg|g|ml|l|ks|kusů|kusy|kus)','i') as pkg
      ) parsed
    ),
    amount_scaled as (
      select a.*,
        case
          when not rec.is_recipe or a.req is null or a.pkg is null then 1::numeric
          when lower(a.req[3]) in ('kg','g') and lower(a.pkg[3]) in ('kg','g') then case when a.variable_price then
            (replace(a.req[1],',','.')::numeric*case when lower(a.req[3])='kg' then 1000 else 1 end)/nullif(replace(a.pkg[1],',','.')::numeric*case when lower(a.pkg[3])='kg' then 1000 else 1 end,0)
          else greatest(1::numeric,ceil((replace(a.req[1],',','.')::numeric*case when lower(a.req[3])='kg' then 1000 else 1 end)/nullif(replace(a.pkg[1],',','.')::numeric*case when lower(a.pkg[3])='kg' then 1000 else 1 end,0))) end
          when lower(a.req[3]) in ('l','ml') and lower(a.pkg[3]) in ('l','ml') then case when a.variable_price then
            (replace(a.req[1],',','.')::numeric*case when lower(a.req[3])='l' then 1000 else 1 end)/nullif(replace(a.pkg[1],',','.')::numeric*case when lower(a.pkg[3])='l' then 1000 else 1 end,0)
          else greatest(1::numeric,ceil((replace(a.req[1],',','.')::numeric*case when lower(a.req[3])='l' then 1000 else 1 end)/nullif(replace(a.pkg[1],',','.')::numeric*case when lower(a.pkg[3])='l' then 1000 else 1 end,0))) end
          when lower(a.req[3])='ks' and lower(a.pkg[3]) in ('ks','kusů','kusy','kus') then greatest(1::numeric,ceil(replace(a.req[1],',','.')::numeric/nullif(replace(a.pkg[1],',','.')::numeric,0)))
          else 1::numeric end as purchase_multiplier
      from amount_parsed a
    ),
    final_candidates as (
      select a.*,
        case when rec.is_recipe and a.req is not null and a.pkg is not null then jsonb_set(
          a.offer || jsonb_build_object('recipe_base_price',(a.offer->>'price')::numeric,'recipe_purchase_multiplier',round(a.purchase_multiplier,6),'recipe_required_amount',replace(a.req[1],',','.')::numeric,'recipe_required_unit',lower(a.req[3])),
          '{price}',to_jsonb(round((a.offer->>'price')::numeric*a.purchase_multiplier,2)),true
        ) else a.offer end as priced_offer
      from amount_scaled a
    )
    select rec.query_text,
      lower(btrim(regexp_replace(public.unaccent(rec.query_text),'[^a-zA-Z0-9]+',' ','g'))) as query_key,
      e.candidate_ord,e.priced_offer,e.total_count
    from final_candidates e
    where not rec.is_recipe or e.exact_count=e.max_exact_count
    order by e.candidate_ord
    limit greatest(1,least(coalesce(p_limit_per_query,30),60));

    if not found then
      query_text:=rec.query_text;
      query_key:=lower(btrim(regexp_replace(public.unaccent(rec.query_text),'[^a-zA-Z0-9]+',' ','g')));
      candidate_rank:=null; offer:=null; total_count:=0; return next;
    end if;
  end loop;
end;
$function$;

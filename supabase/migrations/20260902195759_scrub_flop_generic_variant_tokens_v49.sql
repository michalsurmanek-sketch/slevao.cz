create or replace function private.scrub_flop_generic_variant_tokens_v49()
returns trigger
language plpgsql
set search_path to 'public','private','pg_temp'
as $function$
declare
  v_is_flop boolean := false;
begin
  select exists (
    select 1
    from public.leaflet_imports li
    join public.stores s on s.id=li.store_id
    where li.id=new.import_id and s.slug='flop'
  ) into v_is_flop;

  if not v_is_flop or jsonb_typeof(new.pages) <> 'array' then
    return new;
  end if;

  select coalesce(jsonb_agg(
    case
      when jsonb_typeof(page.value->'tokens')='array' then
        jsonb_set(
          page.value,
          '{tokens}',
          coalesce((
            select jsonb_agg(tok.value order by tok.ordinality)
            from jsonb_array_elements(page.value->'tokens') with ordinality tok(value,ordinality)
            where public.normalize_text(coalesce(tok.value->>'text','')) <> 'vybrane druhy'
          ),'[]'::jsonb),
          true
        )
      else page.value
    end
    order by page.ordinality
  ),'[]'::jsonb)
  into new.pages
  from jsonb_array_elements(new.pages) with ordinality page(value,ordinality);

  return new;
end;
$function$;

revoke all on function private.scrub_flop_generic_variant_tokens_v49() from public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_scrub_flop_generic_variant_tokens_v49 ON public.leaflet_extracted_text;
create trigger trg_scrub_flop_generic_variant_tokens_v49
before insert or update of pages,import_id on public.leaflet_extracted_text
for each row execute function private.scrub_flop_generic_variant_tokens_v49();

update public.leaflet_extracted_text let
set pages=let.pages,
    updated_at=now()
where exists (
  select 1 from public.leaflet_imports li
  join public.stores s on s.id=li.store_id
  where li.id=let.import_id and s.slug='flop'
)
  and jsonb_path_exists(let.pages,'$[*].tokens[*] ? (@.text == "vybrané druhy")');
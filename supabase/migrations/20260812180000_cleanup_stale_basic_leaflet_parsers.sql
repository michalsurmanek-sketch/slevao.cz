create or replace function public.dispatch_pending_basic_leaflet_parsers(p_limit integer default 4)
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $function$
declare
  r record;
  dispatched integer := 0;
begin
  update public.leaflet_basic_parser_runs br
  set
    status = 'failed',
    error_message = coalesce(nullif(br.error_message, ''), 'Základní parser se zasekl a byl automaticky ukončen.'),
    finished_at = now()
  where br.status in ('queued','processing')
    and br.created_at < now() - interval '45 minutes';

  for r in
    select li.id
    from public.leaflet_imports li
    join public.stores s on s.id = li.store_id
    where li.product_count = 0
      and li.source_document_url ~* '\.pdf(\?|$)'
      and li.status in ('review','failed')
      and (
        coalesce(li.metadata->>'ai_unavailable','false') = 'true'
        or li.error_message ilike '%kredit%'
        or li.error_message ilike '%OpenAI%'
        or li.error_message ilike '%32MB%'
        or s.slug in ('hruska','albert')
      )
      and not exists (
        select 1 from public.leaflet_basic_parser_runs br
        where br.import_id = li.id
          and br.status in ('queued','processing','completed')
          and br.created_at > now() - interval '24 hours'
      )
    order by li.created_at desc
    limit greatest(1, least(coalesce(p_limit,4),10))
  loop
    perform public.dispatch_basic_leaflet_parser(r.id);
    dispatched := dispatched + 1;
  end loop;
  return dispatched;
end;
$function$;

update public.leaflet_basic_parser_runs br
set status='failed',
    error_message=coalesce(nullif(br.error_message,''),'Základní parser se zasekl a byl automaticky ukončen.'),
    finished_at=now()
where br.status in ('queued','processing')
  and br.created_at < now()-interval '45 minutes';

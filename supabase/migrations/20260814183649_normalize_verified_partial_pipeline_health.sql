create or replace function public.normalize_verified_partial_pipeline_health()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $$
begin
  if new.parser_version in (
      'coop-verified-pdf-text-v1',
      'lidl-verified-pdf-text-v1',
      'flop-top-jina-pdf-v1'
    )
    and new.last_error is null
    and new.last_parser_error is null
    and coalesce(new.expected_offer_count,0) > 0
    and coalesce(new.last_published_count,0) >= new.expected_offer_count
  then
    new.health_status := 'ok';
    if new.health_reason is not null and new.health_reason not ilike 'Pipeline OK:%' then
      new.health_reason := 'Pipeline OK: ' || new.health_reason;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.normalize_verified_partial_pipeline_health() from public, anon, authenticated;
grant execute on function public.normalize_verified_partial_pipeline_health() to service_role;

drop trigger if exists normalize_verified_partial_pipeline_health_trg on public.store_product_sync_state;
create trigger normalize_verified_partial_pipeline_health_trg
before insert or update on public.store_product_sync_state
for each row
execute function public.normalize_verified_partial_pipeline_health();

update public.store_product_sync_state
set updated_at = updated_at
where parser_version in (
  'coop-verified-pdf-text-v1',
  'lidl-verified-pdf-text-v1',
  'flop-top-jina-pdf-v1'
);

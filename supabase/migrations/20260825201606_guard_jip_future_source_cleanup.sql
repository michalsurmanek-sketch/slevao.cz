create or replace function public.guard_jip_future_source_cleanup()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if coalesce(old.metadata->>'adapter','') = 'jip-flip-pdf-v1'
     and coalesce(new.metadata,'{}'::jsonb) ? 'expired_by_source_at'
     and old.detected_valid_from is not null
     and new.detected_valid_to is not null
     and new.detected_valid_to < old.detected_valid_from then
    new.status := 'ignored';
    new.detected_valid_to := old.detected_valid_to;
    new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
      'cleanup_guard', 'future_source_removed_before_start',
      'cleanup_guarded_at', now()
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_jip_future_source_cleanup on public.leaflet_imports;
create trigger trg_guard_jip_future_source_cleanup
before update on public.leaflet_imports
for each row execute function public.guard_jip_future_source_cleanup();

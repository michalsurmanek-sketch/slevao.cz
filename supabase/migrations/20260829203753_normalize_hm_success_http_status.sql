create or replace function public.normalize_hm_success_http_status()
returns trigger
language plpgsql
security invoker
set search_path to 'public','pg_catalog'
as $function$
begin
  if new.adapter_name='hm-official-api-sale-v1'
     and new.health_status='waiting_source'
     and new.last_error is null
     and new.last_parser_error is null
     and new.last_success_at is not null
     and exists (
       select 1 from public.stores s
       where s.id=new.store_id and s.slug='hm'
     )
  then
    new.last_http_status := 200;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_normalize_hm_success_http_status on public.store_product_sync_state;
create trigger trg_normalize_hm_success_http_status
before insert or update on public.store_product_sync_state
for each row
execute function public.normalize_hm_success_http_status();

update public.store_product_sync_state st
set last_http_status=200,
    updated_at=now()
from public.stores s
where s.id=st.store_id
  and s.slug='hm'
  and st.adapter_name='hm-official-api-sale-v1'
  and st.health_status='waiting_source'
  and st.last_error is null
  and st.last_parser_error is null
  and st.last_success_at is not null;

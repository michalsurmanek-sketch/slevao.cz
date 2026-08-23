create table if not exists private.structured_retail_http_job_history (
  id bigint generated always as identity primary key,
  request_id bigint not null,
  store_id uuid not null,
  adapter text not null,
  status text not null,
  requested_at timestamptz not null,
  processed_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  archived_at timestamptz not null default now(),
  archive_reason text not null
);

create index if not exists structured_retail_http_job_history_request_idx
  on private.structured_retail_http_job_history(request_id, archived_at desc);
create index if not exists structured_retail_http_job_history_store_idx
  on private.structured_retail_http_job_history(store_id, archived_at desc);

create or replace function private.reclaim_structured_retail_http_request_id()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_old public.structured_retail_http_jobs%rowtype;
  v_new_requested_at timestamptz := coalesce(new.requested_at,now());
begin
  select * into v_old
  from public.structured_retail_http_jobs
  where request_id=new.request_id
  for update;

  if not found then
    return new;
  end if;

  if v_old.requested_at >= v_new_requested_at-interval '1 hour' then
    raise exception 'pg_net request_id % koliduje s čerstvým jobem % (% / %).',
      new.request_id,v_old.adapter,v_old.status,v_old.requested_at;
  end if;

  insert into private.structured_retail_http_job_history(
    request_id,store_id,adapter,status,requested_at,processed_at,error_message,metadata,archive_reason
  ) values(
    v_old.request_id,v_old.store_id,v_old.adapter,v_old.status,v_old.requested_at,v_old.processed_at,
    v_old.error_message,coalesce(v_old.metadata,'{}'::jsonb),'pg_net_request_id_reused'
  );

  delete from public.structured_retail_http_jobs where request_id=v_old.request_id;
  return new;
end;
$function$;

revoke all on function private.reclaim_structured_retail_http_request_id() from public, anon, authenticated;

drop trigger if exists structured_retail_http_jobs_reclaim_reused_request_id on public.structured_retail_http_jobs;
create trigger structured_retail_http_jobs_reclaim_reused_request_id
before insert on public.structured_retail_http_jobs
for each row
execute function private.reclaim_structured_retail_http_request_id();

-- Restrict branch synchronization transport tables to trusted backend roles.
-- postgres and service_role bypass RLS; no public client policy is intentionally defined.

alter table public.branch_sync_http_state enable row level security;
alter table public.branch_sync_http_batch enable row level security;

revoke all on table public.branch_sync_http_state from public, anon, authenticated;
revoke all on table public.branch_sync_http_batch from public, anon, authenticated;

comment on table public.branch_sync_http_state is
  'Internal branch synchronization HTTP state. Accessible only to postgres and service_role.';
comment on table public.branch_sync_http_batch is
  'Internal branch synchronization HTTP batches. Accessible only to postgres and service_role.';

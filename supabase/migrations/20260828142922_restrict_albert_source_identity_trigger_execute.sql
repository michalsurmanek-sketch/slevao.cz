revoke execute on function public.enforce_albert_source_scoped_identity() from public;
revoke execute on function public.enforce_albert_source_scoped_identity() from anon;
revoke execute on function public.enforce_albert_source_scoped_identity() from authenticated;
grant execute on function public.enforce_albert_source_scoped_identity() to service_role;

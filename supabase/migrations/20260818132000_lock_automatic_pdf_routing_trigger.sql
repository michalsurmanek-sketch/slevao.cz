revoke all on function public.start_routed_kaufland_pdf_after_insert() from public;
revoke all on function public.start_routed_kaufland_pdf_after_insert() from anon;
revoke all on function public.start_routed_kaufland_pdf_after_insert() from authenticated;
grant execute on function public.start_routed_kaufland_pdf_after_insert() to service_role;

revoke all on function public.route_kaufland_pdf_before_insert() from public;
revoke all on function public.route_kaufland_pdf_before_insert() from anon;
revoke all on function public.route_kaufland_pdf_before_insert() from authenticated;
grant execute on function public.route_kaufland_pdf_before_insert() to service_role;

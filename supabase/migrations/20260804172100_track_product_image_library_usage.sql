create or replace function public.mark_product_image_used(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.product_image_library
  set usage_count = usage_count + 1,
      last_used_at = now(),
      updated_at = now()
  where product_id = p_product_id
    and is_active = true;
end;
$$;

revoke all on function public.mark_product_image_used(uuid) from public, anon, authenticated;
grant execute on function public.mark_product_image_used(uuid) to service_role;

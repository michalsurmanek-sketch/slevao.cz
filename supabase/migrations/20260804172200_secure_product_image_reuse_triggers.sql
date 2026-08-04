alter function public.apply_library_image_to_offer() security definer;
alter function public.apply_library_image_to_leaflet_item() security definer;

revoke all on function public.apply_library_image_to_offer() from public, anon, authenticated;
revoke all on function public.apply_library_image_to_leaflet_item() from public, anon, authenticated;

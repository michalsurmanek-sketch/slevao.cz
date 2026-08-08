-- Pin search_path for public functions so object resolution cannot be influenced
-- by a caller-controlled schema. public is required because pg_trgm/unaccent and
-- application objects currently live there; pg_temp remains last for safe temp use.

alter function public.apply_inferred_leaflet_validity() set search_path = public, pg_temp;
alter function public.infer_leaflet_validity(text, text, jsonb, timestamptz) set search_path = public, pg_temp;
alter function public.keep_leaflet_with_products_in_review() set search_path = public, pg_temp;
alter function public.normalize_product_name(text) set search_path = public, pg_temp;
alter function public.normalize_text(text) set search_path = public, pg_temp;
alter function public.product_aliases_set_normalized() set search_path = public, pg_temp;
alter function public.product_identity_match_safe(text, text, text, text) set search_path = public, pg_temp;
alter function public.product_label_is_specific(text) set search_path = public, pg_temp;
alter function public.product_quantity_key(text) set search_path = public, pg_temp;
alter function public.products_set_normalized_name() set search_path = public, pg_temp;
alter function public.protect_current_leaflet_validity() set search_path = public, pg_temp;
alter function public.slevao_enrich_leaflet_item_specification() set search_path = public, pg_temp;
alter function public.slevao_has_specification(text) set search_path = public, pg_temp;
alter function public.slevao_offer_display_title(text, text, text) set search_path = public, pg_temp;
alter function public.touch_leaflet_ocr_run_updated_at() set search_path = public, pg_temp;
alter function public.touch_product_image_candidate() set search_path = public, pg_temp;
alter function public.touch_store_product_sync_state() set search_path = public, pg_temp;
alter function public.touch_updated_at() set search_path = public, pg_temp;

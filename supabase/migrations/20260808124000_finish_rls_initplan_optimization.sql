-- Use the linter-recognized `(select auth.jwt())` form for the remaining image jobs.
drop policy if exists "staff manage product image library" on public.product_image_library;
create policy "staff manage product image library" on public.product_image_library for all to authenticated
using ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'))
with check ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'));

drop policy if exists "product_image_generation_runs_staff_select" on public.product_image_generation_runs;
create policy "product_image_generation_runs_staff_select" on public.product_image_generation_runs for select to authenticated
using ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'));

drop policy if exists "product_image_generation_jobs_staff_select" on public.product_image_generation_jobs;
create policy "product_image_generation_jobs_staff_select" on public.product_image_generation_jobs for select to authenticated
using ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'));

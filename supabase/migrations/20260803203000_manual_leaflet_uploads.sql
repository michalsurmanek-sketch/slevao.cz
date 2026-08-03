-- Slevao.cz: soukromé úložiště pro ručně nahrané letáky.
-- Soubory může spravovat pouze přihlášený admin nebo editor.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'manual-leaflets',
  'manual-leaflets',
  false,
  52428800,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "staff read manual leaflets" on storage.objects;
drop policy if exists "staff upload manual leaflets" on storage.objects;
drop policy if exists "staff update manual leaflets" on storage.objects;
drop policy if exists "staff delete manual leaflets" on storage.objects;

create policy "staff read manual leaflets"
on storage.objects for select to authenticated
using (
  bucket_id = 'manual-leaflets'
  and (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'editor')
);

create policy "staff upload manual leaflets"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'manual-leaflets'
  and (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'editor')
);

create policy "staff update manual leaflets"
on storage.objects for update to authenticated
using (
  bucket_id = 'manual-leaflets'
  and (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'editor')
)
with check (
  bucket_id = 'manual-leaflets'
  and (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'editor')
);

create policy "staff delete manual leaflets"
on storage.objects for delete to authenticated
using (
  bucket_id = 'manual-leaflets'
  and (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'editor')
);

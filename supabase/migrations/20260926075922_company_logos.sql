-- Public company branding; only the platform owner can upload or remove images.
-- The organisations.logo_url column already exists and is used by client invitations.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-logos', 'company-logos', true, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "platform owner uploads company logos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'company-logos'
  and private.is_platform_admin()
  and (select auth.jwt()->>'email') = 'aruna@aidez.com.au'
  and (storage.foldername(name))[1] in (select id::text from public.organisations)
  and storage.extension(name) in ('png', 'jpg', 'webp')
);

create policy "platform owner removes company logos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'company-logos'
  and private.is_platform_admin()
  and (select auth.jwt()->>'email') = 'aruna@aidez.com.au'
  and (storage.foldername(name))[1] in (select id::text from public.organisations)
);

create policy "platform owner lists company logos"
on storage.objects for select to authenticated
using (
  bucket_id = 'company-logos'
  and private.is_platform_admin()
  and (select auth.jwt()->>'email') = 'aruna@aidez.com.au'
);

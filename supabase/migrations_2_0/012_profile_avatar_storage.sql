-- Mobile_FO_V2 schema migration 2.0
-- 012: Profile avatar storage bucket and policies for web profile photos.
-- Uses the existing profiles.metadata.profile_image_url convention.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = true,
  file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "profile_avatars_public_read" on storage.objects;
drop policy if exists "profile_avatars_own_insert" on storage.objects;
drop policy if exists "profile_avatars_own_update" on storage.objects;
drop policy if exists "profile_avatars_own_delete" on storage.objects;

create policy "profile_avatars_public_read"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'profile-avatars');

create policy "profile_avatars_own_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = 'avatars'
  and (storage.foldername(name))[2] = auth.uid()::text
);

create policy "profile_avatars_own_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = 'avatars'
  and (storage.foldername(name))[2] = auth.uid()::text
)
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = 'avatars'
  and (storage.foldername(name))[2] = auth.uid()::text
);

create policy "profile_avatars_own_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = 'avatars'
  and (storage.foldername(name))[2] = auth.uid()::text
);

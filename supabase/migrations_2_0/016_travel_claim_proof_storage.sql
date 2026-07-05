-- Travel claim proof storage.
-- Private bucket for Auto/Bus/Train/Others bill and ticket uploads.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'travel-claim-proofs',
  'travel-claim-proofs',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf'];

drop policy if exists "travel_claim_proofs_own_read" on storage.objects;
drop policy if exists "travel_claim_proofs_own_insert" on storage.objects;
drop policy if exists "travel_claim_proofs_own_update" on storage.objects;
drop policy if exists "travel_claim_proofs_own_delete" on storage.objects;

create policy "travel_claim_proofs_own_read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'travel-claim-proofs'
  and (
    public.is_current_fo((storage.foldername(name))[1])
    or public.is_qpms_admin()
  )
);

create policy "travel_claim_proofs_own_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'travel-claim-proofs'
  and (
    public.is_current_fo((storage.foldername(name))[1])
    or public.is_qpms_admin()
  )
);

create policy "travel_claim_proofs_own_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'travel-claim-proofs'
  and (
    public.is_current_fo((storage.foldername(name))[1])
    or public.is_qpms_admin()
  )
)
with check (
  bucket_id = 'travel-claim-proofs'
  and (
    public.is_current_fo((storage.foldername(name))[1])
    or public.is_qpms_admin()
  )
);

create policy "travel_claim_proofs_own_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'travel-claim-proofs'
  and (
    public.is_current_fo((storage.foldername(name))[1])
    or public.is_qpms_admin()
  )
);

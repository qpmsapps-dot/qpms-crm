-- 065: Independent client Deep Cleaning workflow foundation.
-- This schema intentionally has no dependency on FO attendance, site visits,
-- live status, GPS logs, or KM calculation tables.

create table if not exists public.client_deep_cleaning_submissions (
  id uuid primary key default gen_random_uuid(),
  business text not null,
  store_id uuid,
  store_code text not null,
  store_name text,
  client_name text,
  state text,
  city text,
  store_format text,
  deep_cleaning_date date,
  performed_by_type text not null default 'vendor',
  vendor_name text,
  submitted_by_user_id uuid not null,
  submitted_by_employee_code text not null,
  remarks text,
  status text not null default 'draft',
  submitted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_client_deep_cleaning_business_not_empty
    check (trim(business) <> ''),
  constraint chk_client_deep_cleaning_store_code_not_empty
    check (trim(store_code) <> ''),
  constraint chk_client_deep_cleaning_performed_by_type
    check (performed_by_type in ('vendor')),
  constraint chk_client_deep_cleaning_status
    check (status in ('draft', 'uploading', 'submitted')),
  constraint chk_client_deep_cleaning_submitted_fields
    check (
      status <> 'submitted'
      or (deep_cleaning_date is not null and submitted_at is not null)
    )
);

create table if not exists public.client_deep_cleaning_uploads (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.client_deep_cleaning_submissions(id) on delete cascade,
  upload_type text not null,
  storage_bucket text not null default 'client-deep-cleaning-uploads',
  storage_path text not null,
  original_filename text,
  mime_type text not null,
  file_size bigint not null,
  sequence_no integer not null default 1,
  uploaded_by_user_id uuid not null,
  upload_status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  uploaded_at timestamptz,
  constraint chk_client_deep_cleaning_upload_type
    check (upload_type in ('before', 'after', 'checklist', 'document')),
  constraint chk_client_deep_cleaning_upload_path_not_empty
    check (trim(storage_path) <> ''),
  constraint chk_client_deep_cleaning_upload_size
    check (file_size between 1 and 5242880),
  constraint chk_client_deep_cleaning_upload_status
    check (upload_status in ('pending', 'uploaded')),
  constraint chk_client_deep_cleaning_upload_completed_at
    check (upload_status <> 'uploaded' or uploaded_at is not null)
);

create unique index if not exists ux_client_deep_cleaning_uploads_storage_object
  on public.client_deep_cleaning_uploads(storage_bucket, storage_path);

create index if not exists idx_client_deep_cleaning_submissions_owner_created
  on public.client_deep_cleaning_submissions(submitted_by_user_id, created_at desc);

create index if not exists idx_client_deep_cleaning_submissions_business_date
  on public.client_deep_cleaning_submissions(business, deep_cleaning_date desc);

create index if not exists idx_client_deep_cleaning_submissions_store
  on public.client_deep_cleaning_submissions(store_code, created_at desc);

create index if not exists idx_client_deep_cleaning_submissions_status
  on public.client_deep_cleaning_submissions(status, created_at desc);

create index if not exists idx_client_deep_cleaning_uploads_submission
  on public.client_deep_cleaning_uploads(submission_id, upload_type, upload_status, sequence_no);

drop trigger if exists trg_client_deep_cleaning_submissions_updated_at
  on public.client_deep_cleaning_submissions;
create trigger trg_client_deep_cleaning_submissions_updated_at
before update on public.client_deep_cleaning_submissions
for each row execute function public.set_updated_at();

insert into storage.buckets (id, name, public)
values ('client-deep-cleaning-uploads', 'client-deep-cleaning-uploads', false)
on conflict (id) do nothing;

alter table public.client_deep_cleaning_submissions enable row level security;
alter table public.client_deep_cleaning_uploads enable row level security;

grant select, insert, update on public.client_deep_cleaning_submissions to authenticated;
grant select, insert, delete on public.client_deep_cleaning_uploads to authenticated;

create or replace function public.is_reliance_retail_fo(p_auth_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.auth_user_id = p_auth_user_id
      and coalesce(p.is_active, true) = true
      and regexp_replace(upper(coalesce(p.role, '')), '[^A-Z0-9]+', '', 'g')
        in ('FO', 'FIELDOFFICER')
      and regexp_replace(upper(coalesce(p.business, '')), '[^A-Z0-9]+', '', 'g')
        in ('RELIANCE', 'RELIANCERETAIL')
  );
$$;

comment on function public.is_reliance_retail_fo(uuid) is
  'Returns true when the authenticated profile is an active Reliance Retail FO allowed to use independent Deep Cleaning.';

grant execute on function public.is_reliance_retail_fo(uuid) to authenticated;

drop policy if exists "client_deep_cleaning_submissions own select"
  on public.client_deep_cleaning_submissions;
drop policy if exists "client_deep_cleaning_submissions own insert"
  on public.client_deep_cleaning_submissions;
drop policy if exists "client_deep_cleaning_submissions own draft update"
  on public.client_deep_cleaning_submissions;
drop policy if exists "client_deep_cleaning_uploads own select"
  on public.client_deep_cleaning_uploads;
drop policy if exists "client_deep_cleaning_uploads own insert"
  on public.client_deep_cleaning_uploads;
drop policy if exists "client_deep_cleaning_uploads own draft delete"
  on public.client_deep_cleaning_uploads;

create policy "client_deep_cleaning_submissions own select"
on public.client_deep_cleaning_submissions
for select
to authenticated
using (
  (submitted_by_user_id = auth.uid() and public.is_reliance_retail_fo(auth.uid()))
  or public.is_qpms_admin()
);

create policy "client_deep_cleaning_submissions own insert"
on public.client_deep_cleaning_submissions
for insert
to authenticated
with check (
  submitted_by_user_id = auth.uid()
  and public.is_reliance_retail_fo(auth.uid())
  and lower(trim(business)) = 'reliance retail'
  and trim(submitted_by_employee_code) <> ''
);

create policy "client_deep_cleaning_submissions own draft update"
on public.client_deep_cleaning_submissions
for update
to authenticated
using (
  (
    submitted_by_user_id = auth.uid()
    and public.is_reliance_retail_fo(auth.uid())
    and status in ('draft', 'uploading')
  )
  or public.is_qpms_admin()
)
with check (
  (
    submitted_by_user_id = auth.uid()
    and public.is_reliance_retail_fo(auth.uid())
    and lower(trim(business)) = 'reliance retail'
    and status in ('draft', 'uploading')
  )
  or public.is_qpms_admin()
);

create policy "client_deep_cleaning_uploads own select"
on public.client_deep_cleaning_uploads
for select
to authenticated
using (
  exists (
    select 1
    from public.client_deep_cleaning_submissions s
    where s.id = submission_id
      and (s.submitted_by_user_id = auth.uid() or public.is_qpms_admin())
      and (public.is_reliance_retail_fo(auth.uid()) or public.is_qpms_admin())
  )
);

create policy "client_deep_cleaning_uploads own insert"
on public.client_deep_cleaning_uploads
for insert
to authenticated
with check (
  uploaded_by_user_id = auth.uid()
  and exists (
    select 1
    from public.client_deep_cleaning_submissions s
    where s.id = submission_id
      and s.submitted_by_user_id = auth.uid()
      and public.is_reliance_retail_fo(auth.uid())
      and s.status in ('draft', 'uploading')
  )
);

create policy "client_deep_cleaning_uploads own draft delete"
on public.client_deep_cleaning_uploads
for delete
to authenticated
using (
  exists (
    select 1
    from public.client_deep_cleaning_submissions s
    where s.id = submission_id
      and (s.submitted_by_user_id = auth.uid() or public.is_qpms_admin())
      and (public.is_reliance_retail_fo(auth.uid()) or public.is_qpms_admin())
      and s.status in ('draft', 'uploading')
  )
);

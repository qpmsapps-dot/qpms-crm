-- Mobile_FO_V2 schema migration 2.0
-- 004: Storage bucket, grants, RLS policies.

insert into storage.buckets (id, name, public)
values ('fo-activity-uploads', 'fo-activity-uploads', false)
on conflict (id) do nothing;

grant usage on schema public to anon, authenticated;

grant select (id, employee_code, mobile, email, role, is_active)
  on public.profiles to anon;
grant select, insert, update on public.profiles to authenticated;

grant select, insert, update on public.fo_attendance to authenticated;
grant select, insert, update on public.fo_live_status to authenticated;
grant select, insert on public.fo_location_logs to authenticated;
grant select, insert, update on public.fo_site_visits to authenticated;
grant select, insert, update on public.fo_daily_tasks to authenticated;
grant select, insert, update on public.fo_activity_submissions to authenticated;
grant select, insert on public.fo_activity_uploads to authenticated;
grant select, insert on public.store_master to authenticated;
grant insert on public.mobile_crash_logs to anon, authenticated;
grant select on public.mobile_crash_logs to authenticated;

alter table public.profiles enable row level security;
alter table public.fo_attendance enable row level security;
alter table public.fo_live_status enable row level security;
alter table public.fo_location_logs enable row level security;
alter table public.fo_site_visits enable row level security;
alter table public.fo_daily_tasks enable row level security;
alter table public.fo_activity_submissions enable row level security;
alter table public.fo_activity_uploads enable row level security;
alter table public.store_master enable row level security;
alter table public.mobile_crash_logs enable row level security;

drop policy if exists "profiles anon fo duplicate lookup" on public.profiles;
drop policy if exists "profiles authenticated own select" on public.profiles;
drop policy if exists "profiles authenticated own insert" on public.profiles;
drop policy if exists "profiles authenticated own update" on public.profiles;
drop policy if exists "profiles admins select all" on public.profiles;

create policy "profiles anon fo duplicate lookup"
on public.profiles
for select
to anon
using (role in ('FO', 'Field Officer'));

create policy "profiles authenticated own select"
on public.profiles
for select
to authenticated
using (auth_user_id = auth.uid() or public.is_qpms_admin());

create policy "profiles authenticated own insert"
on public.profiles
for insert
to authenticated
with check (auth_user_id = auth.uid());

create policy "profiles authenticated own update"
on public.profiles
for update
to authenticated
using (auth_user_id = auth.uid() or public.is_qpms_admin())
with check (auth_user_id = auth.uid() or public.is_qpms_admin());

drop policy if exists "fo_attendance own select" on public.fo_attendance;
drop policy if exists "fo_attendance own insert" on public.fo_attendance;
drop policy if exists "fo_attendance own update" on public.fo_attendance;

create policy "fo_attendance own select"
on public.fo_attendance
for select
to authenticated
using (public.is_current_fo(fo_user_id) or public.is_current_fo(employee_code) or public.is_qpms_admin());

create policy "fo_attendance own insert"
on public.fo_attendance
for insert
to authenticated
with check (public.is_current_fo(fo_user_id) or public.is_current_fo(employee_code) or public.is_qpms_admin());

create policy "fo_attendance own update"
on public.fo_attendance
for update
to authenticated
using (public.is_current_fo(fo_user_id) or public.is_current_fo(employee_code) or public.is_qpms_admin())
with check (public.is_current_fo(fo_user_id) or public.is_current_fo(employee_code) or public.is_qpms_admin());

drop policy if exists "fo_live_status own select" on public.fo_live_status;
drop policy if exists "fo_live_status own insert" on public.fo_live_status;
drop policy if exists "fo_live_status own update" on public.fo_live_status;

create policy "fo_live_status own select"
on public.fo_live_status
for select
to authenticated
using (public.is_current_fo(fo_user_id) or public.is_qpms_admin());

create policy "fo_live_status own insert"
on public.fo_live_status
for insert
to authenticated
with check (public.is_current_fo(fo_user_id) or public.is_qpms_admin());

create policy "fo_live_status own update"
on public.fo_live_status
for update
to authenticated
using (public.is_current_fo(fo_user_id) or public.is_qpms_admin())
with check (public.is_current_fo(fo_user_id) or public.is_qpms_admin());

drop policy if exists "fo_location_logs own select" on public.fo_location_logs;
drop policy if exists "fo_location_logs own insert" on public.fo_location_logs;

create policy "fo_location_logs own select"
on public.fo_location_logs
for select
to authenticated
using (public.is_current_fo(fo_user_id) or public.is_current_fo(employee_code) or public.is_qpms_admin());

create policy "fo_location_logs own insert"
on public.fo_location_logs
for insert
to authenticated
with check (public.is_current_fo(fo_user_id) or public.is_current_fo(employee_code) or public.is_qpms_admin());

drop policy if exists "fo_site_visits own select" on public.fo_site_visits;
drop policy if exists "fo_site_visits own insert" on public.fo_site_visits;
drop policy if exists "fo_site_visits own update" on public.fo_site_visits;

create policy "fo_site_visits own select"
on public.fo_site_visits
for select
to authenticated
using (public.is_current_fo(fo_user_id) or public.is_current_fo(employee_code) or public.is_qpms_admin());

create policy "fo_site_visits own insert"
on public.fo_site_visits
for insert
to authenticated
with check (public.is_current_fo(fo_user_id) or public.is_current_fo(employee_code) or public.is_qpms_admin());

create policy "fo_site_visits own update"
on public.fo_site_visits
for update
to authenticated
using (public.is_current_fo(fo_user_id) or public.is_current_fo(employee_code) or public.is_qpms_admin())
with check (public.is_current_fo(fo_user_id) or public.is_current_fo(employee_code) or public.is_qpms_admin());

drop policy if exists "fo_daily_tasks own select" on public.fo_daily_tasks;
drop policy if exists "fo_daily_tasks own insert" on public.fo_daily_tasks;
drop policy if exists "fo_daily_tasks own update" on public.fo_daily_tasks;

create policy "fo_daily_tasks own select"
on public.fo_daily_tasks
for select
to authenticated
using (public.is_current_fo(fo_user_id) or public.is_current_fo(employee_code) or public.is_qpms_admin());

create policy "fo_daily_tasks own insert"
on public.fo_daily_tasks
for insert
to authenticated
with check (public.is_current_fo(fo_user_id) or public.is_current_fo(employee_code) or public.is_qpms_admin());

create policy "fo_daily_tasks own update"
on public.fo_daily_tasks
for update
to authenticated
using (public.is_current_fo(fo_user_id) or public.is_current_fo(employee_code) or public.is_qpms_admin())
with check (public.is_current_fo(fo_user_id) or public.is_current_fo(employee_code) or public.is_qpms_admin());

drop policy if exists "fo_activity_submissions own select" on public.fo_activity_submissions;
drop policy if exists "fo_activity_submissions own insert" on public.fo_activity_submissions;
drop policy if exists "fo_activity_submissions own update" on public.fo_activity_submissions;

create policy "fo_activity_submissions own select"
on public.fo_activity_submissions
for select
to authenticated
using (public.is_current_fo(fo_user_id) or public.is_current_fo(employee_code) or public.is_qpms_admin());

create policy "fo_activity_submissions own insert"
on public.fo_activity_submissions
for insert
to authenticated
with check (public.is_current_fo(fo_user_id) or public.is_current_fo(employee_code) or public.is_qpms_admin());

create policy "fo_activity_submissions own update"
on public.fo_activity_submissions
for update
to authenticated
using (public.is_current_fo(fo_user_id) or public.is_current_fo(employee_code) or public.is_qpms_admin())
with check (public.is_current_fo(fo_user_id) or public.is_current_fo(employee_code) or public.is_qpms_admin());

drop policy if exists "fo_activity_uploads own select" on public.fo_activity_uploads;
drop policy if exists "fo_activity_uploads own insert" on public.fo_activity_uploads;

create policy "fo_activity_uploads own select"
on public.fo_activity_uploads
for select
to authenticated
using (public.is_current_fo(fo_user_id) or public.is_current_fo(employee_code) or public.is_qpms_admin());

create policy "fo_activity_uploads own insert"
on public.fo_activity_uploads
for insert
to authenticated
with check (public.is_current_fo(fo_user_id) or public.is_current_fo(employee_code) or public.is_qpms_admin());

drop policy if exists "store_master authenticated read active" on public.store_master;
drop policy if exists "store_master fo insert created stores" on public.store_master;

create policy "store_master authenticated read active"
on public.store_master
for select
to authenticated
using (status = 'Active' or public.is_qpms_admin());

create policy "store_master fo insert created stores"
on public.store_master
for insert
to authenticated
with check (public.is_current_fo(created_by_employee_code) or public.is_qpms_admin());

drop policy if exists "mobile_crash_logs insert anon authenticated" on public.mobile_crash_logs;
drop policy if exists "mobile_crash_logs authenticated select own" on public.mobile_crash_logs;

create policy "mobile_crash_logs insert anon authenticated"
on public.mobile_crash_logs
for insert
to anon, authenticated
with check (true);

create policy "mobile_crash_logs authenticated select own"
on public.mobile_crash_logs
for select
to authenticated
using (
  public.is_qpms_admin()
  or public.is_current_fo(fo_user_id)
  or public.is_current_fo(employee_code)
);

drop policy if exists "fo_activity_uploads_authenticated_read" on storage.objects;
drop policy if exists "fo_activity_uploads_authenticated_insert" on storage.objects;
drop policy if exists "fo_activity_uploads_authenticated_update" on storage.objects;
drop policy if exists "fo_activity_uploads_authenticated_delete" on storage.objects;

create policy "fo_activity_uploads_authenticated_read"
on storage.objects
for select
to authenticated
using (bucket_id = 'fo-activity-uploads');

create policy "fo_activity_uploads_authenticated_insert"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'fo-activity-uploads');

create policy "fo_activity_uploads_authenticated_update"
on storage.objects
for update
to authenticated
using (bucket_id = 'fo-activity-uploads')
with check (bucket_id = 'fo-activity-uploads');

create policy "fo_activity_uploads_authenticated_delete"
on storage.objects
for delete
to authenticated
using (bucket_id = 'fo-activity-uploads');

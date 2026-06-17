-- 008: Repair FO site visit RLS for mobile Check-In / Check-Out.
-- Allows an authenticated FO to insert/update only visits for their own
-- employee code and own attendance row.

create or replace function public.current_fo_employee_code()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_employee_code text;
begin
  select p.employee_code
  into v_employee_code
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and upper(trim(coalesce(p.role, ''))) in ('FO', 'FIELD OFFICER')
    and coalesce(p.is_active, true) = true
  order by p.created_at desc
  limit 1;

  return nullif(trim(v_employee_code), '');
end;
$$;

create or replace function public.is_current_fo(p_employee_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    upper(trim(public.current_fo_employee_code())) =
    upper(trim(coalesce(p_employee_code, ''))),
    false
  )
$$;

grant execute on function public.current_fo_employee_code() to authenticated;
grant execute on function public.is_current_fo(text) to authenticated;

grant select, insert, update on public.fo_attendance to authenticated;
grant select, insert, update on public.fo_site_visits to authenticated;

alter table public.fo_attendance enable row level security;
alter table public.fo_site_visits enable row level security;

drop policy if exists "fo_attendance own select" on public.fo_attendance;
drop policy if exists "fo_attendance own insert" on public.fo_attendance;
drop policy if exists "fo_attendance own update" on public.fo_attendance;

create policy "fo_attendance own select"
on public.fo_attendance
for select
to authenticated
using (
  public.is_current_fo(fo_user_id)
  or public.is_current_fo(employee_code)
  or public.is_qpms_admin()
);

create policy "fo_attendance own insert"
on public.fo_attendance
for insert
to authenticated
with check (
  public.is_current_fo(fo_user_id)
  or public.is_current_fo(employee_code)
  or public.is_qpms_admin()
);

create policy "fo_attendance own update"
on public.fo_attendance
for update
to authenticated
using (
  public.is_current_fo(fo_user_id)
  or public.is_current_fo(employee_code)
  or public.is_qpms_admin()
)
with check (
  public.is_current_fo(fo_user_id)
  or public.is_current_fo(employee_code)
  or public.is_qpms_admin()
);

drop policy if exists "fo_site_visits own select" on public.fo_site_visits;
drop policy if exists "fo_site_visits own insert" on public.fo_site_visits;
drop policy if exists "fo_site_visits own update" on public.fo_site_visits;

create policy "fo_site_visits own select"
on public.fo_site_visits
for select
to authenticated
using (
  public.is_qpms_admin()
  or public.is_current_fo(fo_user_id)
  or public.is_current_fo(employee_code)
  or exists (
    select 1
    from public.fo_attendance attendance
    where attendance.id = fo_site_visits.attendance_id
      and (
        public.is_current_fo(attendance.fo_user_id)
        or public.is_current_fo(attendance.employee_code)
      )
  )
);

create policy "fo_site_visits own insert"
on public.fo_site_visits
for insert
to authenticated
with check (
  public.is_qpms_admin()
  or (
    (
      public.is_current_fo(fo_user_id)
      or public.is_current_fo(employee_code)
    )
    and attendance_id is not null
    and exists (
      select 1
      from public.fo_attendance attendance
      where attendance.id = fo_site_visits.attendance_id
        and (
          public.is_current_fo(attendance.fo_user_id)
          or public.is_current_fo(attendance.employee_code)
      )
    )
  )
);

create policy "fo_site_visits own update"
on public.fo_site_visits
for update
to authenticated
using (
  public.is_qpms_admin()
  or (
    (
      public.is_current_fo(fo_user_id)
      or public.is_current_fo(employee_code)
    )
    and attendance_id is not null
    and exists (
      select 1
      from public.fo_attendance attendance
      where attendance.id = fo_site_visits.attendance_id
        and (
          public.is_current_fo(attendance.fo_user_id)
          or public.is_current_fo(attendance.employee_code)
      )
    )
  )
)
with check (
  public.is_qpms_admin()
  or (
    (
      public.is_current_fo(fo_user_id)
      or public.is_current_fo(employee_code)
    )
    and attendance_id is not null
    and exists (
      select 1
      from public.fo_attendance attendance
      where attendance.id = fo_site_visits.attendance_id
        and (
          public.is_current_fo(attendance.fo_user_id)
          or public.is_current_fo(attendance.employee_code)
      )
    )
  )
);

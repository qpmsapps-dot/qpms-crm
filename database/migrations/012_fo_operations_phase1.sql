-- Migration 012: FO Operations Phase 1
-- Purpose: Field Officer daily tasks, GPS tracking, site visits, and conveyance reporting.
-- Safe additive migration. Does not replace CRM/site visit approval workflow.

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.fo_sites (
  id uuid primary key default gen_random_uuid(),
  site_name text not null,
  client_name text,
  address text,
  state text,
  region text,
  latitude numeric(10, 7) not null,
  longitude numeric(10, 7) not null,
  geofence_radius_meters integer not null default 100,
  status text not null default 'Active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fo_attendance (
  id uuid primary key default gen_random_uuid(),
  fo_user_id text not null,
  attendance_date date not null default current_date,
  login_time timestamptz not null,
  logout_time timestamptz,
  status text not null default 'present',
  start_latitude numeric(10, 7),
  start_longitude numeric(10, 7),
  end_latitude numeric(10, 7),
  end_longitude numeric(10, 7),
  start_battery_percentage integer,
  end_battery_percentage integer,
  total_raw_km numeric(10, 2) not null default 0,
  total_approved_km numeric(10, 2) not null default 0,
  eligibility_status text not null default 'Needs Review',
  sync_status text not null default 'synced',
  local_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fo_daily_tasks (
  id uuid primary key default gen_random_uuid(),
  fo_user_id text not null,
  attendance_id uuid references public.fo_attendance(id) on delete set null,
  task_date date not null default current_date,
  site_id uuid references public.fo_sites(id) on delete set null,
  site_name text not null,
  reason_for_visit text not null,
  planned_sequence integer not null default 1,
  task_status text not null default 'planned',
  navigation_started_at timestamptz,
  created_from text not null default 'mobile',
  sync_status text not null default 'synced',
  local_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fo_site_visits (
  id uuid primary key default gen_random_uuid(),
  fo_user_id text not null,
  attendance_id uuid references public.fo_attendance(id) on delete set null,
  fo_daily_task_id uuid references public.fo_daily_tasks(id) on delete set null,
  site_id uuid references public.fo_sites(id) on delete set null,
  site_name text not null,
  check_in_time timestamptz,
  check_out_time timestamptz,
  check_in_latitude numeric(10, 7),
  check_in_longitude numeric(10, 7),
  check_out_latitude numeric(10, 7),
  check_out_longitude numeric(10, 7),
  gps_accuracy numeric(10, 2),
  geofence_status text not null default 'Pending',
  distance_from_site_meters numeric(10, 2),
  work_performed text,
  remarks text,
  visit_status text not null default 'navigation_started',
  time_spent_minutes integer,
  raw_km numeric(10, 2) not null default 0,
  approved_km numeric(10, 2) not null default 0,
  sync_status text not null default 'synced',
  local_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fo_location_logs (
  id uuid primary key default gen_random_uuid(),
  fo_user_id text not null,
  attendance_id uuid references public.fo_attendance(id) on delete set null,
  task_id uuid references public.fo_daily_tasks(id) on delete set null,
  site_visit_id uuid references public.fo_site_visits(id) on delete set null,
  logged_at timestamptz not null,
  latitude numeric(10, 7) not null,
  longitude numeric(10, 7) not null,
  accuracy numeric(10, 2),
  speed numeric(10, 2),
  battery_percentage integer,
  is_mocked boolean,
  source text not null default 'mobile',
  sync_status text not null default 'synced',
  local_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.fo_conveyance_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  fo_user_id text not null,
  attendance_id uuid references public.fo_attendance(id) on delete cascade,
  login_time timestamptz,
  logout_time timestamptz,
  visits_count integer not null default 0,
  completed_tasks_count integer not null default 0,
  raw_km numeric(10, 2) not null default 0,
  approved_km numeric(10, 2) not null default 0,
  rate_per_km numeric(10, 2) not null default 4,
  petrol_amount numeric(10, 2) generated always as (approved_km * rate_per_km) stored,
  eligibility_status text not null default 'Needs Review',
  approval_status text not null default 'Pending',
  reason text,
  remarks text,
  edited_by text,
  edited_at timestamptz,
  edit_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fo_conveyance_audit_logs (
  id uuid primary key default gen_random_uuid(),
  conveyance_report_id uuid references public.fo_conveyance_reports(id) on delete cascade,
  edited_by text,
  edit_reason text,
  old_value jsonb not null default '{}'::jsonb,
  new_value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists ux_fo_sites_site_name_address
  on public.fo_sites(lower(site_name), coalesce(lower(address), ''));
create unique index if not exists ux_fo_attendance_local_id
  on public.fo_attendance(local_id);
create unique index if not exists ux_fo_daily_tasks_local_id
  on public.fo_daily_tasks(local_id);
create unique index if not exists ux_fo_location_logs_local_id
  on public.fo_location_logs(local_id);
create unique index if not exists ux_fo_site_visits_local_id
  on public.fo_site_visits(local_id);
create unique index if not exists ux_fo_conveyance_attendance
  on public.fo_conveyance_reports(attendance_id)
  where attendance_id is not null;
create unique index if not exists ux_fo_conveyance_attendance_upsert
  on public.fo_conveyance_reports(attendance_id);

create index if not exists idx_fo_attendance_user_date
  on public.fo_attendance(fo_user_id, attendance_date desc);
create index if not exists idx_fo_daily_tasks_user_date
  on public.fo_daily_tasks(fo_user_id, task_date desc, task_status);
create index if not exists idx_fo_location_logs_attendance_time
  on public.fo_location_logs(attendance_id, logged_at);
create index if not exists idx_fo_site_visits_user_time
  on public.fo_site_visits(fo_user_id, check_in_time desc);
create index if not exists idx_fo_conveyance_user_date
  on public.fo_conveyance_reports(fo_user_id, report_date desc);

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'fo_sites',
    'fo_attendance',
    'fo_daily_tasks',
    'fo_site_visits',
    'fo_conveyance_reports'
  ]
  loop
    if not exists (
      select 1
      from pg_trigger
      where tgname = 'set_updated_at_' || v_table
    ) then
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
        'set_updated_at_' || v_table,
        v_table
      );
    end if;
  end loop;
end $$;

insert into public.fo_sites (
  site_name,
  client_name,
  address,
  state,
  region,
  latitude,
  longitude,
  geofence_radius_meters,
  status
)
values (
  'QPMS Office',
  'QPMS',
  'QPMS Office, Chennai',
  'Tamil Nadu',
  'Chennai',
  13.029051,
  80.248947,
  100,
  'Active'
)
on conflict do nothing;
